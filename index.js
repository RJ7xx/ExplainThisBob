process.removeAllListeners('warning');

const fetch = require('node-fetch');

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

async function main() {
    await login();
}

main().catch(console.error);
