process.removeAllListeners('warning');

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const CONFIG = {
    TWITTER_API_KEY: '',
    OPENROUTER_API_KEY: '',
    REFRESH_INTERVAL: 2000,

    X_USERNAME: '',
    X_EMAIL: '',
    X_PASSWORD: '',
    X_TOTP: '',

    PROXY: '',
};

let LOGIN_COOKIE = null;

const queue = [];
let processing = false;

const TRACKED_TWEETS_FILE = path.join(__dirname, 'tracked_ai_tweets.json');
const trackedTweets = new Set();

async function login() {
    try {
        const response = await fetch('https://api.twitterapi.io/twitter/user_login_v2', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': CONFIG.TWITTER_API_KEY
            },
            body: JSON.stringify({
                user_name: CONFIG.X_USERNAME,
                email: CONFIG.X_EMAIL,
                password: CONFIG.X_PASSWORD,
                proxy: CONFIG.PROXY,
                totp_secret: CONFIG.X_TOTP
            })
        });

        if (!response.ok) {
            throw new Error(`Twitter login failed: ${response.status}`);
        }

        const data = await response.json();

        if (data.status !== 'success' || !data.login_cookies) {
            throw new Error(`Twitter login error: ${data.msg || 'Unknown error'}`);
        }

        LOGIN_COOKIE = data.login_cookies;

        console.log('Twitter login successful, cookie obtained.');
    } catch (error) {
        console.error('Twitter login error:', error.message);
        throw error;
    }
}

async function pollMentions() {
    try {
        console.log(`[ ${new Date().toISOString()} ] Polling mentions...`);
        const result = await fetchMentions();

        if (!result) {
            console.log('No results from the API');
            return;
        }

        if (!Array.isArray(result.tweets)) {
            console.log('Invalid data structure:', JSON.stringify(result).substring(0, 200));
            return;
        }

        const tweets = result.tweets;

        for (const tweet of tweets) {
            if (!tweet || !tweet.id) continue;

            const isAlreadyTracked = trackedTweets.has(tweet.id);
            if (isAlreadyTracked) {
                continue;
            }

            console.log(`New tweet: ${tweet.id} from @${tweet.author.userName}: ${tweet.text.substring(0, 50)}`);

            trackedTweets.add(tweet.id);
            saveTrackedTweets();

            queue.push(tweet);
        }

        processQueue();
    } catch (error) {
        console.error('Error polling mentions:', error.message);
    }
}

async function fetchMentions() {
    try {
        const url = `https://api.twitterapi.io/twitter/user/mentions?userName=${CONFIG.X_USERNAME}`;

        const response = await fetch(url, {
            headers: {
                'X-API-Key': CONFIG.TWITTER_API_KEY
            }
        });

        if (!response.ok) {
            throw new Error(`API returned ${response.status}`);
        }

        const data = await response.json();

        return data;
    } catch (error) {
        console.error('Error fetching mentions:', error.message);
        return null;
    }
}

async function processQueue() {
    if (processing || queue.length === 0) {
        return;
    }

    processing = true;

    while (queue.length > 0) {
        const tweet = queue.shift();
        await processTweet(tweet);

        if (queue.length > 0) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    processing = false;
}

async function processTweet(tweet) {
    try {
        console.log(`Processing tweet ${tweet.id}...`);

        const question = extractQuestion(tweet);
        if (!question) {
            return console.log(`Tweet ${tweet.id} - no bot mention or invalid format, skipping`);
        }

        console.log(`Question extracted: '${question}'`);
        let fullContext = question;
        const imageUrls = extractImages(tweet);

        // If this is a reply, then it fetches the original tweet for context
        if (tweet.isReply && tweet.inReplyToId) {
            console.log(`Fetching original tweet ${tweet.inReplyToId} for context...`);
            const originalTweet = await fetchOriginalTweet(tweet.inReplyToId);

            if (originalTweet) {
                fullContext = `Original tweet by @${originalTweet.author.userName}: '${originalTweet.text}'\n\nReply: ${question}`;
                console.log(`Added original tweet context`);
            }
        }

        console.log(`Calling AI with question: ${fullContext.substring(0, 80)}`);

        if (imageUrls.length > 0) {
            console.log(`Tweet has ${imageUrls.length} image(s)`);
        }

        const aiResponse = await getAIResponse(fullContext, imageUrls);
        console.log(`AI Response received: ${aiResponse.substring(0, 100)}${aiResponse.length > 100 ? '...' : ''}`);

        await sendTwitterReply(aiResponse, tweet.id);
    } catch (error) {
        console.error('Error processing tweet:', error.message);
    }
}

function saveTrackedTweets() {
    try {
        fs.writeFileSync(TRACKED_TWEETS_FILE, JSON.stringify(Array.from(trackedTweets), null, 2));
    } catch (error) {
        console.error('Error saving tracked tweets:', error.message);
    }
}

async function main() {
    await login();

    await pollMentions();

    setInterval(() => {
        pollMentions().catch((error) => {
            console.error('Poll error:', error.message)
        });
    }, CONFIG.REFRESH_INTERVAL);
}

main().catch(console.error);
