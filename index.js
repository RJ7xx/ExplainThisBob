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
