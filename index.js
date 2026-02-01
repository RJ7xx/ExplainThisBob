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

const TRACKED_TWEETS_FILE = path.join(__dirname, 'tweets.json');
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

async function reply(replyText, replyToTweetId) {
    if (!LOGIN_COOKIE) {
        return console.error('No login cookie available for reply.');
    }

    try {
        const response = await fetch('https://api.twitterapi.io/twitter/create_tweet_v2', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': CONFIG.TWITTER_API_KEY
            },
            body: JSON.stringify({
                login_cookies: LOGIN_COOKIE,
                tweet_text: replyText,
                proxy: CONFIG.PROXY,
                reply_to_tweet_id: replyToTweetId
            })
        });

        const data = await response.json();

        if (data.status !== 'success') {
            throw new Error(data.msg || 'Unknown error');
        }

        console.log(`Tweet reply sent! Tweet ID: ${data.tweet_id}`);
    } catch (error) {
        console.error('Error sending Twitter reply:', error);
    }
}

async function getAIResponse(question, imageUrls = []) {
    try {
        const content = [];

        content.push({
            type: 'text',
            text: question
        });

        for (const imageUrl of imageUrls) {
            content.push({
                type: 'image_url',
                image_url: {
                    url: imageUrl
                }
            });
        }

        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${CONFIG.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'openai/gpt-5-mini',
                messages: [
                    {
                        role: 'system',
                        content: 'Respond as ExplainThisBob, an internet meme character known for over-explaining jokes and obvious statements.\n\nYour response should:\n- Be technically correct but unnecessarily detailed\n- Break down obvious ideas step-by-step\n- Use an academic, analytical tone\n- Miss the emotional or social point slightly\n- Do not use EM dashes\n- Explain things that most people already understand\n- Sound earnest, not sarcastic\n\nThe humor should come from excessive clarification, not from jokes or punchlines. Do not mention that you are an AI or that you are parodying anything. Simply explain.\n\nKeep responses short and concise - maximum 2-3 sentences.'
                    },
                    {
                        role: 'user',
                        content: content
                    }
                ]
            })
        });

        if (!response.ok) {
            throw new Error(`OpenRouter API returned ${response.status}`);
        }

        const data = await response.json();
        if (data.choices && data.choices.length > 0 && data.choices[0].message) {
            return data.choices[0].message.content;
        }

        return 'No response from OpenRouter';
    } catch (error) {
        console.error('Error getting AI response:', error.message);
        return `Error: ${error.message}`;
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

        await reply(aiResponse, tweet.id);
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

function loadTrackedTweets() {
    try {
        if (fs.existsSync(TRACKED_TWEETS_FILE)) {
            const data = fs.readFileSync(TRACKED_TWEETS_FILE, 'utf8');
            const count = JSON.parse(data).length;

            JSON.parse(data).forEach(id => trackedTweets.add(id));

            console.log(`Loaded ${count} tracked tweets`);
        } else {
            console.log('No tracked tweets file yet');
        }
    } catch (error) {
        console.error('Error loading tracked tweets:', error.message);
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
    loadTrackedTweets();

    await login();
    await pollMentions();

    setInterval(() => {
        pollMentions().catch((error) => {
            console.error('Poll error:', error.message)
        });
    }, CONFIG.REFRESH_INTERVAL);
}

main().catch(console.error);
