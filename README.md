# ExplainThisBob

So I created this bot because I liked the meme. I saw some other devs create this and tokenise it but they always scammed their users for pennies which was pretty stupid.

I'll explain how to run your own version of Bob, basically your own AI on X.

<hr>
<h3>Steps on how to fill in the missing config values:</h3>

You need to get an API key from [twitterapi.io](https://twitterapi.io/) and [openrouter.ai](https://openrouter.ai/).
> This is needed to get the users that have mentioned the bot, see what they wrote and to reply back to them. You need OpenRouter to generate a response from an AI, they have a wide selection to pick from and it's kinda cool.
<br>

Then you just need to input the bot's account information
> You need the TOTP secret key since it makes the login more reliable and less likely to be banned. To get this, enable 2FA authentication, select the option to "can't scan the QR code," and X will provide you with the TOTP/2FA secret key.
<br>

You will also need to get a static residential proxy
> Do not use free proxies, instead get "static residential" proxies from [webshare.io](https://www.webshare.io) for about $6. Example of what you would get `http://user:pass:ip:port` / `http://jhupgwvy:z849fz98dk1p:45.56.177.96:8897`

<hr>
<h3>Steps on how to run the code:</h3>

1. Clone the code into your area.
2. Run `npm install` or `npm install path fs node-fetch@2.7.0`
3. Run `node index.js`
4. The bot should fully run by itself now
