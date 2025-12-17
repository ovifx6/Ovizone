const axios = require('axios');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

module.exports.config = {
    name: "install",
    version: "1.5.0",
    hasPermission: 0,
    credits: "rX Abdullah",
    description: "Install a JS command from code or URL; auto-load it immediately.",
    usePrefix: true,
    commandCategory: "utility",
    usages: "[filename.js] [code or url]",
    cooldowns: 5
};

// --- Safety check for credits ---
(function(){
    const _d = s => Buffer.from(s, 'base64').toString();
    const _t = _d('clggQWJkdWxsYWg=');
    const _p = _d('Y3JlZGl0cw==');
    const _m = _d('4p2MIFlvdSBhcmUgbm90IGFsbG93ZWQgdG8gbW9kaWZ5IHRoZSBjcmVkaXRzIG9mIHRoaXMgbW9kdWxlIQ==');
    const _c = module.exports.config[_p];
    if (_c !== _t) throw new Error(_m);
})();

// --- Function to autoload installed command ---
const loadInstalledCommand = ({ filename, api, threadID, messageID }) => {
    const { writeFileSync, readFileSync } = global.nodemodule['fs-extra'];
    const { join } = global.nodemodule['path'];
    const { configPath, mainPath } = global.client;
    const logger = require(mainPath + '/utils/log');

    try {
        const dirModule = path.join(__dirname, filename);
        delete require.cache[require.resolve(dirModule)];
        const command = require(dirModule);

        if (!command.config || !command.run || !command.config.commandCategory)
            throw new Error('[ 𝗜𝗡𝗦𝗧𝗔𝗟𝗟 ] - Module is not properly formatted!');

        // Handle dependencies
        if (command.config.dependencies && typeof command.config.dependencies === 'object') {
            const listPackage = JSON.parse(readFileSync('./package.json')).dependencies;
            const listbuiltinModules = require('module')['builtinModules'];
            for (const packageName in command.config.dependencies) {
                if (listPackage.hasOwnProperty(packageName) || listbuiltinModules.includes(packageName))
                    global.nodemodule[packageName] = require(packageName);
                else
                    global.nodemodule[packageName] = require(join(global.client.mainPath, 'nodemodules', 'node_modules', packageName));
            }
        }

        // Register event if exists
        if (command.handleEvent) global.client.eventRegistered.push(command.config.name);

        // Add to commands map
        global.client.commands.set(command.config.name, command);

        logger.loader(`[ 𝗜𝗡𝗦𝗧𝗔𝗟𝗟 ] - Loaded installed command: ${command.config.name}`);
        return api.sendMessage(`✅ Installed & autoloaded: ${filename}`, threadID, messageID);
    } catch (err) {
        console.error(err);
        return api.sendMessage(`❌ Failed to autoload command: ${filename}\n` + err.message, threadID, messageID);
    }
};

// --- Main install command ---
module.exports.run = async ({ api, args, event }) => {
    try {
        const filename = args[0];
        const rest = args.slice(1).join(' ').trim();

        if (!filename || !rest) {
            return api.sendMessage(
                '⚠️ Usage:\n!install filename.js <paste code here> OR !install filename.js <url>',
                event.threadID,
                event.messageID
            );
        }

        if (filename.includes('..') || path.isAbsolute(filename)) {
            return api.sendMessage('❌ Invalid file name!', event.threadID, event.messageID);
        }

        if (!filename.endsWith('.js')) {
            return api.sendMessage('❌ File name must end with .js', event.threadID, event.messageID);
        }

        // Fetch code from URL if needed
        let codeData;
        const isURL = /^(http|https):\/\/[^ "]+$/;
        if (isURL.test(rest)) {
            try {
                const res = await axios.get(rest);
                codeData = res.data;
            } catch (err) {
                return api.sendMessage(`❌ Failed to fetch code from URL:\n${err.message}`, event.threadID, event.messageID);
            }
        } else {
            codeData = rest;
        }

        // Check syntax
        try { new vm.Script(codeData); } 
        catch (err) {
            return api.sendMessage('❌ Code has syntax error:\n' + err.message, event.threadID, event.messageID);
        }

        const savePath = path.join(__dirname, filename);

        // If file exists → ask for reaction to replace
        if (fs.existsSync(savePath)) {
            return api.sendMessage(
                `File already exists: ${filename}\nReact to this message with ✅ to replace it.\n❮ Reaction this message to complete ❯`,
                event.threadID,
                (err, info) => {
                    if (err) return console.error(err);
                    global.client.handleReaction = global.client.handleReaction || [];
                    global.client.handleReaction.push({
                        type: "replace_file",
                        name: module.exports.config.name,
                        messageID: info.messageID,
                        author: event.senderID,
                        filename,
                        code: codeData
                    });
                }
            );
        }

        // Write new file and autoload
        fs.writeFileSync(savePath, codeData, 'utf-8');
        return loadInstalledCommand({ filename, api, threadID: event.threadID, messageID: event.messageID });

    } catch (e) {
        console.error('install.js error:', e);
        return api.sendMessage('❌ Something went wrong while installing the file.', event.threadID, event.messageID);
    }
};

// --- Handle reaction for replacing existing file ---
module.exports.handleReaction = async ({ api, event, handleReaction }) => {
    try {
        if (!handleReaction || handleReaction.type !== "replace_file") return;
        if (event.userID != handleReaction.author) return; // Only author can react

        const reaction = event.reaction || event.reactionText || event.reactionType;
        if (reaction != "✅" && reaction != '👍') return;

        const { filename, code } = handleReaction;
        const savePath = path.join(__dirname, filename);

        if (fs.existsSync(savePath)) fs.unlinkSync(savePath);
        fs.writeFileSync(savePath, code, 'utf-8');

        try { api.unsendMessage(handleReaction.messageID); } catch(e){ /* ignore */ }

        // Autoload after replace
        return loadInstalledCommand({ filename, api, threadID: event.threadID, messageID: event.messageID });

    } catch (e) {
        console.error('handleReaction install.js error:', e);
        return api.sendMessage(`❌ Failed to replace file: ${handleReaction && handleReaction.filename ? handleReaction.filename : 'unknown'}`, event.threadID, event.messageID);
    }
};
