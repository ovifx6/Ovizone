const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");
const stream = require("stream");
const { promisify } = require("util");
const pipeline = promisify(stream.pipeline);
const cheerio = require("cheerio");

module.exports.config = {
  name: "cron",
  version: "7.0.0",
  hasPermssion: 0,
  credits: "Rx Abdullah edit by tamim",
  description: "Search video & send direct link or download (User-Agent safe)",
  commandCategory: "media",
  usages: "!cron <keyword>",
  cooldowns: 5
};

// Helper to fetch direct video URL from Xvideos page
async function getDirectVideoUrl(videoName) {
  try {
    const searchUrl = 'https://www.xvideos.com/?k=' + encodeURIComponent(videoName);
    const { data: searchData } = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      },
      timeout: 15000
    });

    const $ = cheerio.load(searchData);
    let videoPageUrl = null;

    $('.thumb-block').each((i, el) => {
      if (videoPageUrl) return;
      const link = $(el).find('a').attr('href');
      if (link && link.includes('/video')) {
        videoPageUrl = 'https://www.xvideos.com' + link;
      }
    });

    if (!videoPageUrl) return null;

    const { data: videoPage } = await axios.get(videoPageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 15000
    });

    const highMatch = videoPage.match(/setVideoUrlHigh\('([^']+)'\)/);
    const lowMatch = videoPage.match(/setVideoUrlLow\('([^']+)'\)/);

    if (highMatch) return { url: highMatch[1], quality: 'high' };
    if (lowMatch) return { url: lowMatch[1], quality: 'low' };

    return null;
  } catch (err) {
    console.error("Error getting direct URL:", err.message);
    return null;
  }
}

// Download stream with headers
async function getStreamFromURL(url, path = "") {
  const response = await axios({
    method: "GET",
    url,
    responseType: "stream",
    headers: {
      'Range': 'bytes=0-',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://www.xvideos.com/'
    },
    timeout: 60000
  });

  if (path) response.data.path = path;
  const totalLength = response.headers["content-length"];
  return { stream: response.data, size: totalLength };
}

module.exports.run = async function ({ api, event, args }) {
  const { threadID, messageID, senderID } = event;
  if (!args.length) return api.sendMessage("❌ Use: /cron <মিয়া খলিফা>", threadID, messageID);

  const keyword = args.join(" ");
  const cacheDir = path.join(__dirname, "tmp");
  fs.ensureDirSync(cacheDir);

  try {
    // 1️⃣ Fetch video list from your API
    const res = await axios.get(`https://cron-video.onrender.com/?q=${encodeURIComponent(keyword)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 15000
    });

    const videos = res.data?.videos || [];
    if (!videos.length) return api.sendMessage("❌ No videos found!", threadID, messageID);

    // 2️⃣ Send search results with thumbnails
    let body = "🎬 Search Results:\n\n";
    const attachments = [];

    videos.slice(0, 5).forEach((v, i) => {
      body += `${i + 1}. ${v.title || "No title"}\n`;
      if (v.thumbnail) attachments.push(fs.createReadStream(v.thumbnail));
    });

    body += `\n↩ Reply with number (1-${videos.length})`;

    api.sendMessage({ body, attachment: attachments }, threadID, (err, info) => {
      if (err) return console.error(err);
      global.client.handleReply.push({
        name: module.exports.config.name,
        messageID: info.messageID,
        author: senderID,
        data: videos
      });
    });

  } catch (err) {
    console.error(err);
    api.sendMessage("❌ API error!", threadID, messageID);
  }
};

module.exports.handleReply = async function ({ api, event, handleReply }) {
  const { threadID, senderID, body } = event;
  if (senderID !== handleReply.author) return;

  const index = parseInt(body);
  if (isNaN(index) || index < 1 || index > handleReply.data.length)
    return api.sendMessage("❌ Invalid number!", threadID);

  const selected = handleReply.data[index - 1];

  api.unsendMessage(handleReply.messageID);

  // Get direct URL via helper
  const directUrl = selected.directMp4Url ? { url: selected.directMp4Url } : await getDirectVideoUrl(selected.title);
  if (!directUrl || !directUrl.url)
    return api.sendMessage("❌ Video link not available", threadID);

  const savePath = path.join(__dirname, `tmp/${Date.now()}_${index}.mp4`);
  const MAX_SIZE = 26 * 1024 * 1024;

  try {
    const { stream: videoStream, size } = await getStreamFromURL(directUrl.url, savePath);

    if (size && parseInt(size) > MAX_SIZE) {
      return api.sendMessage("❌ Video too large (>26MB)", threadID);
    }

    await pipeline(videoStream, fs.createWriteStream(savePath));

    api.sendMessage(
      { body: selected.title || "Video", attachment: fs.createReadStream(savePath) },
      threadID,
      () => fs.existsSync(savePath) && fs.unlinkSync(savePath)
    );

  } catch (err) {
    console.error(err);
    api.sendMessage("❌ Download failed! Link may be expired or blocked", threadID);
  }
};
