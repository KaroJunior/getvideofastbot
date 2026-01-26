const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');
const ytdlp = require('yt-dlp-exec');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const https = require('https'); 

// Configure ffmpeg path
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

require('dotenv').config();

const express = require('express');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Configuration
const MAX_VIDEO_DURATION = parseInt(process.env.MAX_VIDEO_DURATION) || 90; // seconds
const MAX_FILE_SIZE = (parseInt(process.env.MAX_FILE_SIZE) || 50) * 1024 * 1024; // bytes
const TMP_DIR = path.join(__dirname, 'tmp');

// ---- Express keep-alive server (for Render) ----
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.status(200).send('🤖 getvideofastbot is running');
});

app.listen(PORT, () => {
    console.log(`🌐 HTTP server running on port ${PORT}`);
});

// ---- Render keep-alive ping ----
const KEEP_ALIVE_URL = 'https://getvideofastbot.onrender.com';

setInterval(() => {
    https.get(KEEP_ALIVE_URL, (res) => {
        console.log(`🔁 Keep-alive ping — ${res.statusCode}`);
    }).on('error', (err) => {
        console.error('❌ Keep-alive ping failed:', err.message);
    });
}, 5 * 60 * 1000); // every 5 minutes

// Ensure tmp directory exists
if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
}

// Cleanup function for temporary files
const cleanupFile = (filePath) => {
    if (fs.existsSync(filePath)) {
        fs.unlink(filePath, (err) => {
            if (err) console.error(`Error deleting file ${filePath}:`, err);
        });
    }
};

ytdlp('--version')
    .then(v => console.log('🎞 yt-dlp version:', v))
    .catch(err => console.error('❌ yt-dlp error:', err.message));

// ---- Usage logging ----
const USAGE_LOG_PATH = path.join(__dirname, 'usage-log.json');

const loadUsageLog = () => {
    if (!fs.existsSync(USAGE_LOG_PATH)) {
        return {
            totalDownloads: 0,
            users: {},
            platforms: {
                instagram: 0,
                tiktok: 0,
                x: 0,
                facebook: 0
            }
        };
    }
    return JSON.parse(fs.readFileSync(USAGE_LOG_PATH, 'utf8'));
};

const saveUsageLog = (data) => {
    fs.writeFileSync(USAGE_LOG_PATH, JSON.stringify(data, null, 2));
};

const logUsageSummary = (usage) => {
    console.log('📊 ===== USAGE SUMMARY =====');
    console.log(`📥 Total downloads: ${usage.totalDownloads}`);
    console.log(`👥 Unique users: ${Object.keys(usage.users).length}`);

    console.log('📦 Platforms:');
    for (const [platform, count] of Object.entries(usage.platforms)) {
        console.log(`   - ${platform}: ${count}`);
    }

    console.log('📊 =========================');
};

const detectPlatform = (url) => {
    if (url.includes('instagram.com')) return 'instagram';
    if (url.includes('tiktok.com')) return 'tiktok';
    if (url.includes('x.com') || url.includes('twitter.com')) return 'x';
    if (url.includes('facebook.com')) return 'facebook';
    return 'unknown';
};

// Updated to store usernames instead of IDs
const logUsage = (ctx, url) => {
    const chatId = ctx.chat.id;
    const username = ctx.from.username || chatId.toString();
    const usage = loadUsageLog();
    const platform = detectPlatform(url);

    usage.totalDownloads += 1;

    if (!usage.users[username]) {
        usage.users[username] = 0;
    }
    usage.users[username] += 1;

    if (usage.platforms[platform] !== undefined) {
        usage.platforms[platform] += 1;
    }

    saveUsageLog(usage);

    console.log(
        `📊 Usage | user=${username} | platform=${platform} | total=${usage.totalDownloads}`
    );

    // Log summary every 10 downloads
    if (usage.totalDownloads % 10 === 0) {
        logUsageSummary(usage);
    }
};

// Helper function to check if link is supported
const isSupportedLink = (text) => {
    const patterns = [
        /(?:https?:\/\/)?(?:www\.)?(?:instagram\.com|instagr\.am)\/(?:reel|p)\/[A-Za-z0-9_-]+/,
        /(?:https?:\/\/)?(?:www\.)?(?:tiktok\.com)\/(?:@[\w.]+\/video\/|v\/)\d+/,
        /(?:https?:\/\/)?(?:vm\.tiktok\.com)\/\S+/,
        /(?:https?:\/\/)?(?:vt\.tiktok\.com)\/\S+/,
        /(?:https?:\/\/)?(?:www\.)?(?:x\.com|twitter\.com)\/\w+\/status\/\d+/,
        /(?:https?:\/\/)?(?:www\.)?facebook\.com\/.*\/videos\/\d+/,
        /(?:https?:\/\/)?(?:www\.)?facebook\.com\/watch\/\?v=\d+/,
        /(?:https?:\/\/)?fb\.watch\/\S+/,
        /(?:https?:\/\/)?(?:www\.)?facebook\.com\/share\/v\/\S+/,
        /(?:https?:\/\/)?(?:www\.)?facebook\.com\/share\/r\/\S+/
    ];
    return patterns.some(pattern => pattern.test(text));
};

// Function to extract video info
const getVideoInfo = async (url) => {
    console.log('ℹ️ Fetching video info:', url);
    try {
        const info = await ytdlp(url, {
            dumpJson: true,
            noWarnings: true,
        });
        return info;
    } catch (error) {
        console.error('❌ Error getting video info:', error.message);
        return null;
    }
};

// Function to compress video if needed
const compressVideo = async (inputPath, outputPath, targetSize) => {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .videoCodec('libx264')
            .audioCodec('aac')
            .outputOptions([
                '-crf 28',
                '-preset fast',
                '-movflags +faststart'
            ])
            .on('end', () => resolve(outputPath))
            .on('error', (err) => reject(err))
            .save(outputPath);
    });
};

// Function to download video
const downloadVideo = async (url, chatId) => {
    const timestamp = Date.now();
    const filename = `${chatId}_${timestamp}`;
    const outputPath = path.join(TMP_DIR, `${filename}.mp4`);
    console.log('📥 Downloading video:', url);

    try {
        const info = await getVideoInfo(url);
        if (!info) throw new Error('Could not fetch video information');

        if (info.duration > MAX_VIDEO_DURATION) {
            throw new Error(`Video too long. Maximum allowed duration is ${MAX_VIDEO_DURATION} seconds.`);
        }

        console.log('⬇️ Starting download...');
        await ytdlp(url, {
            output: outputPath,
            format: 'mp4',
            noWarnings: true,
        });

        if (!fs.existsSync(outputPath)) throw new Error('Download failed - no file created');

        const stats = fs.statSync(outputPath);
        let finalPath = outputPath;

        if (stats.size > MAX_FILE_SIZE) {
            console.log('📦 File too large, compressing...');
            const compressedPath = path.join(TMP_DIR, `${filename}_compressed.mp4`);
            await compressVideo(outputPath, compressedPath, MAX_FILE_SIZE);
            cleanupFile(outputPath);
            finalPath = compressedPath;
        }

        console.log('✅ Download completed:', finalPath);
        return finalPath;
    } catch (error) {
        console.error('❌ Download error:', error.message);
        if (fs.existsSync(outputPath)) cleanupFile(outputPath);
        throw error;
    }
};

// Process video link
const processVideoLink = async (ctx, url) => {
    const messageId = ctx.message.message_id;

    try {
        const processingMsg = await ctx.reply('⏳ Downloading video...', {
            reply_to_message_id: messageId
        });

        const videoPath = await downloadVideo(url, ctx.chat.id);
        logUsage(ctx, url);

        console.log('📤 Sending video to chat:', ctx.chat.id);

        await ctx.replyWithVideo({ source: videoPath }, {
            caption: 'Downloaded with @getvideofastbot',
            reply_to_message_id: messageId
        });

        await ctx.deleteMessage(processingMsg.message_id);
        cleanupFile(videoPath);

    } catch (error) {
        console.error('❌ Error processing video:', error.message);
        let errorMessage = '❌ Failed to download video. ';
        if (error.message.includes('Video too long')) errorMessage = `❌ ${error.message}`;
        else if (error.message.includes('Unsupported URL') || error.message.includes('not found')) errorMessage = '❌ Invalid or unsupported link.';
        else if (error.message.includes('private') || error.message.includes('login')) errorMessage = '❌ This video is private or requires login.';
        else if (error.message.includes('429')) errorMessage = '❌ Rate limited by Platform. Please try again later.';
        else errorMessage += 'Please try again with a different link.';

        await ctx.reply(errorMessage, { reply_to_message_id: messageId });
    }
};

// Text message handler
bot.on('text', async (ctx) => {
    const text = ctx.message.text;

    if (isSupportedLink(text)) {
        await processVideoLink(ctx, text);
    } else {
        ctx.reply('Send me a supported video link and I’ll download it for you.');
    }
});

// Error handling
bot.catch((err, ctx) => {
    console.error(`Error for ${ctx.updateType}:`, err);
    if (ctx.message) ctx.reply('❌ An error occurred. Please try again later.');
});

// Cleanup tmp directory on startup
const cleanupOldFiles = () => {
    fs.readdir(TMP_DIR, (err, files) => {
        if (err) return;
        const now = Date.now();
        const maxAge = 30 * 60 * 1000;
        files.forEach(file => {
            const filePath = path.join(TMP_DIR, file);
            fs.stat(filePath, (err, stats) => {
                if (!err && (now - stats.mtimeMs) > maxAge) cleanupFile(filePath);
            });
        });
    });
};

bot.telegram.getMe()
    .then(me => console.log(`🤖 Connected as @${me.username}`))
    .catch(err => console.error('❌ Telegram API connection failed:', err.message));

// Start bot
bot.launch().then(() => {
    console.log('✅ Bot started and connected to Telegram');
    cleanupOldFiles();
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
