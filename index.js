const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');
const ytdlp = require('yt-dlp-exec'); // REMOVED .default
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');

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


// Helper function to check if link is supported
const isSupportedLink = (text) => {
    const patterns = [
        // Instagram
        /(?:https?:\/\/)?(?:www\.)?(?:instagram\.com|instagr\.am)\/(?:reel|p)\/([A-Za-z0-9_-]+)/,

        // TikTok
        /(?:https?:\/\/)?(?:www\.)?(?:tiktok\.com)\/(?:@[\w\.]+\/video\/|v\/)(\d+)/,
        /(?:https?:\/\/)?(?:vm\.tiktok\.com)\/(\S+)/,
        /(?:https?:\/\/)?(?:vt\.tiktok\.com)\/(\S+)/,
    ];

    return patterns.some(p => p.test(text));
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
        console.error('Error getting video info:', error.message);
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
        // Get video info first
        const info = await getVideoInfo(url);
        if (!info) {
            throw new Error('Could not fetch video information');
        }

        // Check duration
        if (info.duration > MAX_VIDEO_DURATION) {
            throw new Error(`Video too long. Maximum allowed duration is ${MAX_VIDEO_DURATION} seconds.`);
        }

        // Download video using execPromise directly (more reliable)
        console.log('⬇️ Starting download...');
        await ytdlp(url, {
            output: outputPath,
            format: 'mp4',
            noWarnings: true,
        });

        
        // Check if file was created
        if (!fs.existsSync(outputPath)) {
            throw new Error('Download failed - no file created');
        }

        // Check file size and compress if necessary
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
        // Cleanup on error
        if (fs.existsSync(outputPath)) {
            cleanupFile(outputPath);
        }
        throw error;
    }
};

// Process video link
const processVideoLink = async (ctx, url) => {
    const chatId = ctx.chat.id;
    const messageId = ctx.message.message_id;

    try {
        // Send "processing" message
        const processingMsg = await ctx.reply('⏳ Downloading video...', {
            reply_to_message_id: messageId
        });

        // Download video
        const videoPath = await downloadVideo(url, chatId);

        console.log('📤 Sending video to chat:', chatId);

        // Send video to user
        await ctx.replyWithVideo(
            { source: videoPath },
            {
                caption: 'Downloaded with @getvideofastbot',
                reply_to_message_id: messageId
            }
        );

        // Delete processing message
        await ctx.deleteMessage(processingMsg.message_id);

        // Cleanup temporary file
        cleanupFile(videoPath);

    } catch (error) {
        console.error('❌ Error processing video:', error.message);
        
        // Send error message
        let errorMessage = '❌ Failed to download video. ';
        
        if (error.message.includes('Video too long')) {
            errorMessage = `❌ ${error.message}`;
        } else if (error.message.includes('Unsupported URL') || error.message.includes('not found')) {
            errorMessage = '❌ Invalid or unsupported link. Please check the URL.';
        } else if (error.message.includes('private') || error.message.includes('login')) {
            errorMessage = '❌ This video is private or requires login.';
        } else if (error.message.includes('429')) {
            errorMessage = '❌ Rate limited by Instagram/TikTok. Please try again in a few minutes.';
        } else {
            errorMessage += 'Please try again with a different link.';
        }

        await ctx.reply(errorMessage, {
            reply_to_message_id: messageId
        });
    }
};

// Text message handler
bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    
    // Check if message contains a supported link
    if (isSupportedLink(text)) {
        await processVideoLink(ctx, text);
    } else {
        // Original bot response for non-link messages
        ctx.reply('Send me an Instagram Reel or TikTok link to download the video.');
    }
});

// Error handling
bot.catch((err, ctx) => {
    console.error(`Error for ${ctx.updateType}:`, err);
    if (ctx.message) {
        ctx.reply('❌ An error occurred. Please try again later.');
    }
});

// Cleanup tmp directory on startup (remove old files)
const cleanupOldFiles = () => {
    fs.readdir(TMP_DIR, (err, files) => {
        if (err) return;
        
        const now = Date.now();
        const maxAge = 30 * 60 * 1000; // 30 minutes
        
        files.forEach(file => {
            const filePath = path.join(TMP_DIR, file);
            fs.stat(filePath, (err, stats) => {
                if (!err && (now - stats.mtimeMs) > maxAge) {
                    cleanupFile(filePath);
                }
            });
        });
    });
};

bot.telegram.getMe()
    .then(me => {
        console.log(`🤖 Connected as @${me.username}`);
    })
    .catch(err => {
        console.error('❌ Telegram API connection failed:', err.message);
    });


// Start bot
bot.launch().then(() => {
    console.log('✅ Bot started and connected to Telegram');
    cleanupOldFiles(); // Clean old files on startup 
});

// Kepp bot alive
const axios = require('axios');

setInterval(() => {
  axios.get('https://getvideofastbot.onrender.com')
    .then(() => console.log('💤 Keep-alive ping sent'))
    .catch(() => console.log('💤 Keep-alive ping failed'));
}, 5 * 60 * 1000); // every 5 minutes

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
