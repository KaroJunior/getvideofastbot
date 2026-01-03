# 🎥 getvideofastbot

A simple Telegram bot that lets you **download Instagram Reels and TikTok videos** quickly — no watermark, no extra apps.

Built as a fun challenge to explore Telegram bots, Node.js, and video processing.

---

## ✨ Features

- 📥 Download videos from:
  - Instagram Reels
  - TikTok (standard + shortened links)
- 🚀 Fast downloads using `yt-dlp`
- 🎞 Automatically compresses videos if they’re too large
- 🤖 Easy to use — just send a link
- 🌐 Hosted as a web service (kept alive with a lightweight HTTP server)

---

## 🧠 How It Works

1. Send an Instagram or TikTok link to the bot
2. The bot:
   - Fetches video metadata
   - Checks duration and file size
   - Downloads the video
   - Compresses it if needed
3. The video is sent back directly in Telegram

Temporary files are cleaned up automatically.

---

## 🛠 Tech Stack

- **Node.js**
- **Telegraf** (Telegram Bot API)
- **yt-dlp**
- **FFmpeg**
- **Express** (keep-alive server)
- **Render** (hosting)

---

## 🚀 Getting Started (Local Development)

### 1️⃣ Clone the repository

bash
git clone https://github.com/KaroJunior/getvideofastbot.git
cd getvideofastbot


### 2️⃣ Install dependencies

bash
npm install


### 3️⃣ Set up environment variables

Create a .env file in the project root:

BOT_TOKEN=your_telegram_bot_token
MAX_VIDEO_DURATION=90
MAX_FILE_SIZE=50


### 4️⃣ Run the bot

bash
node index.js

The bot will start and connect to Telegram.

---

## 🌍 Deployment Notes
* Designed to run as a web service (not a background worker) 
* Includes a minimal Express server to prevent free-tier sleeping 
* Tested on Render 
* Only one instance should run at a time (Telegram polling limitation) 

---

## ⚠️ Limitations
* ❌ YouTube Shorts are not supported (login restrictions) 
* ⏱ Videos longer than the configured duration are rejected 
* 🔒 Private or restricted videos may fail to download 
* 📉 Free hosting may occasionally restart the service 


## 📌 Example Usage
Send a link like: 
https://www.instagram.com/reel/XXXXXXXX/
or
https://vt.tiktok.com/XXXXXXXX/

The bot handles the rest.

---

## 👤 Author
Created by Karo Junior 
- Telegram: https://t.me/@kingkkaro
- Website: https://karojunior.netlify.app 
- GitHub: https://github.com/KaroJunior

---

## 📄 License
MIT — feel free to learn from it, fork it, or build something better.

