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
        const response = await fetch(`https://api.twitterapi.io/twitter/user/mentions?userName=${CONFIG.X_USERNAME}`, {
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

function extractQuestion(tweet) {
    const text = (tweet && tweet.text) ? tweet.text.trim() : '';

    if (!text) {
        return null;
    }

    const hasMonitorMention = (
        (tweet.entities && Array.isArray(tweet.entities.user_mentions) && tweet.entities.user_mentions.some(m => m.screen_name && m.screen_name.toLowerCase() === CONFIG.X_USERNAME.toLowerCase())) || new RegExp(`@${CONFIG.X_USERNAME}\\b`, 'i').test(text)
    );

    if (!hasMonitorMention) {
        return null;
    }

    let question = text.replace(new RegExp(`@${CONFIG.X_USERNAME}\\b`, 'gi'), '').trim();

    return question;
}

async function fetchOriginalTweet(tweetId) {
    try {
        const response = await fetch(`https://api.twitterapi.io/twitter/tweets?tweet_ids=${tweetId}`, {
            headers: {
                'X-API-Key': CONFIG.TWITTER_API_KEY
            }
        });

        if (!response.ok) {
            return null;
        }

        const data = await response.json();

        if (data.tweets && data.tweets.length > 0) {
            return data.tweets[0];
        }

        return null;
    } catch (error) {
        console.error('Error fetching original tweet:', error.message);
        return null;
    }
}

function extractImages(tweet) {
    const imageUrls = [];

    if (tweet.extendedEntities && tweet.extendedEntities.media && tweet.extendedEntities.media.length > 0) {
        for (const media of tweet.extendedEntities.media) {
            if (media.type === 'photo' && media.media_url_https) {
                imageUrls.push(media.media_url_https);
            }
        }
    }

    return imageUrls;
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
