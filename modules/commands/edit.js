const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

module.exports.config = {
    name: "edit",
    version: "1.0",
    credits: "rX Abdullah",
    description: "Image editing using API (GitHub Auto API)",
    usages: "!edit prompt <image/url> OR reply to an image",
    commandCategory: "AI",
    cooldowns: 5
};

// GitHub JSON API file
const API_JSON_URL = "https://raw.githubusercontent.com/rummmmna21/rx-api/main/baseApiUrl.json";

// Load "edit" API from GitHub JSON
async function loadApiUrl() {
    try {
        const res = await axios.get(API_JSON_URL);
        return res.data.edit2; // <- API from JSON key
    } catch (e) {
        console.log("API Load Error:", e);
        return null;
    }
}

function extractImageUrl(args, event) {
    let imageUrl = args.find(a => a.startsWith("http"));

    if (!imageUrl && event.messageReply && event.messageReply.attachments?.length > 0) {
        const img = event.messageReply.attachments.find(
            a => a.type === "photo" || a.type === "image"
        );
        if (img?.url) imageUrl = img.url;
    }

    return imageUrl;
}

function extractPrompt(args, imageUrl) {
    let prompt = args.join(" ");

    if (imageUrl) prompt = prompt.replace(imageUrl, "").trim();
    if (prompt.includes("|")) prompt = prompt.split("|")[0].trim();

    return prompt || "enhance quality";
}

module.exports.run = async function ({ api, event, args }) {

    const API_ENDPOINT = await loadApiUrl();

    if (!API_ENDPOINT)
        return api.sendMessage("❌ Failed to load API from GitHub JSON.", event.threadID, event.messageID);

    const imageUrl = extractImageUrl(args, event);
    const prompt = extractPrompt(args, imageUrl);

    if (!imageUrl)
        return api.sendMessage("❌ Please give an image URL or reply to an image.", event.threadID, event.messageID);

    api.setMessageReaction("⏳", event.messageID, () => {}, true);

    let tempFile;

    try {
        const fullApiUrl = `${API_ENDPOINT}?prompt=${encodeURIComponent(prompt)}&url=${encodeURIComponent(imageUrl)}`;

        const apiRes = await axios.get(fullApiUrl);
        const data = apiRes.data;

        if (!data.success || !data.imageUrl)
            throw new Error(data.error || "API did not return imageUrl");

        const finalUrl = data.imageUrl;

        const imgStream = await axios.get(finalUrl, { responseType: "stream" });

        const cache = path.join(__dirname, "/cache");
        if (!fs.existsSync(cache)) fs.mkdirSync(cache);

        tempFile = path.join(cache, `nano_edit_${Date.now()}.png`);

        const writer = fs.createWriteStream(tempFile);
        imgStream.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on("finish", resolve);
            writer.on("error", reject);
        });

        api.setMessageReaction("✅", event.messageID, () => {}, true);

        return api.sendMessage(
            {
                body: `✨ Edited Image Ready!\nPrompt: ${prompt}`,
                attachment: fs.createReadStream(tempFile)
            },
            event.threadID,
            () => fs.unlinkSync(tempFile),
            event.messageID
        );

    } catch (err) {
        console.log("EDIT ERROR:", err);

        api.setMessageReaction("❌", event.messageID, () => {}, true);

        return api.sendMessage(
            `❌ Error: ${err.message || "Something went wrong."}`,
            event.threadID,
            event.messageID
        );
    }
};
