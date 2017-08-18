const Discord = require('discord.io');
const logger = require('winston');
const auth = require('./auth.json');
//const auth = require('./auth-test.json');
const sql = require('sqlite');

const dbFile = './subs.sqlite';

const COMMAND_PREFIX = 'p!';

// Configure logger settings
logger.remove(logger.transports.Console);
logger.add(logger.transports.Console, {
    colorize: true
});
logger.level = 'debug';

// Initialize Discord Bot
const bot = new Discord.Client({
    token: auth.token,
    autorun: true
});

// Initialize the database
initializeDB();

const supportedCommands = { 'ping': pong, 'sub': sub, 'spawn': spawn, 'help': help, 'stats': stats };

bot.on('ready', function (evt) {
    logger.info('Connected');
    logger.info('Logged in as: ' + bot.username + ' - (' + bot.id + ')');
});

bot.on('message', function (user, userID, channelID, message, evt) {
    // Our bot needs to know if it will execute a command
    // It will listen for messages that will start with `!`
    var msg = message.toLowerCase();
    if (msg.substring(0, COMMAND_PREFIX.length) === COMMAND_PREFIX) {
        logger.info('Command detected: "' + message + '". Interpreted as "' + msg + '"');
        var args = msg.substring(COMMAND_PREFIX.length).split(' ');
        var cmd = args[0];

        args = args.splice(1);
        f = supportedCommands[cmd];
        if (f) {
            try {
                f(user, userID, channelID, args, evt);
            }
            catch (err) {
                logger.error(`Error executing command '${message}': ${err}`);
            }
        }
        else {
            bot.sendMessage({to: channelID, message: 'Unknown command: ' + cmd + '. Use !help to see available commands.'});
        }
    }
});

function getGuildIdForChannel(channelId) {
    if (bot && channelId) {
        try {
            var channel = bot.channels[channelId];
            if (channel) {
                return channel.guild_id;
            }
        }
        catch (err) {
            logger.warn(err);
        }
    }
    return 0;
}

/** 
The help command handler.
*/
function help(user, userID, channelID, args, evt) {
    message = 'Available commands:' +
        '\r\n`p!ping`: Checks to see if the bot is running' +
        '\r\n`p!sub add <pokemon>`: Add a subscription for the specified <pokemon>. You will receive a confirmation DM.' +
        '\r\n`p!sub remove <pokemon>`: Removes a subscription for the specified <pokemon>. You will receive a confirmation DM.' +
        '\r\n`p!sub list`: Sends a DM with a list of all pokemon you are subscribed to.' +
        '\r\n`p!spawn <pokemon>`: Sends a DM to all people subscribed to the specified <pokemon> indicating that one has spawned. If sent as a comment on an image, the uploaded image will also be included in the DM.'
    bot.sendMessage({ to: channelID, message: message });
}

/** 
The ping command handler.
*/
function pong(user, userID, channelID, args, evt) {
    bot.sendMessage({
        to: channelID,
        message: 'Pong!'
    });
};

/** 
The sub command handler.
*/
function sub(user, userID, channelID, args, evt) {
    if (args) {
        flag = args[0];
        var guildId = getGuildIdForChannel(channelID);
        if (guildId) {
            if ((flag === 'add' || flag === 'remove') && args.length >= 2) {
                pokemon = args[1];
                if (flag === 'add') {
                    addSub(userID, guildId, pokemon);
                }
                else if (flag === 'remove') {
                    removeSub(userID, guildId, pokemon);
                }
            }
            else if (flag === 'list' && args.length >= 1) {
                listSubs(userID, guildId);
            }
            else {
                bot.sendMessage({ to: channelID, message: 'Invalid usage' });
            }
        }
        else {
            bot.sendMessage({ to: userID, message: 'Your subscriptions are connected to your server, which cannot be determined from a PM. Please run this command from a server channel.' });
        }
    }
    else {
        bot.sendMessage({ to: channelID, message: 'Invalid usage' });
    }
};

/** 
The spawn command handler. 
*/
function spawn(user, userID, channelID, args, evt) {
    if (args) {
        pokemon = args[0];
        var imageUrl = null;
        var guildId = getGuildIdForChannel(channelID);
        if (guildId) {
            if (evt.d.attachments && evt.d.attachments.length > 0) {
                imageUrl = evt.d.attachments[0].proxy_url;
            }
            sleep(5000).then(() => { notifySubs(pokemon, guildId, imageUrl); });
            bot.sendMessage({ to: channelID, message: 'Sent out alerts for ' + pokemon.toUpperCase() });
        }
        else {
            bot.sendMessage({ to: userID, message: 'Subscriptions are connected to a server, which cannot be determined from a PM. Please run this command from a server channel.' });
        }
    }
}


function stats(user, userID, channelID, args, evt) {
    var guildId = getGuildIdForChannel(channelID);
    if (guildId) {
        showStatsForGuild(userID, guildId);
    }
}

function showStatsForGuild(userId, guildId) {
    if (userId && guildId) {
        sql.all('SELECT guildId, COUNT(DISTINCT userId) AS trainers, COUNT(DISTINCT pokemon) AS pokemon, COUNT(*) AS totalSubs FROM subcription GROUP BY guildId HAVING guildId=?', [guildId]).then((stats) => {
            var message = `On this server, ${stats[0].trainers} trainers are subscribed to ${stats[0].pokemon} different pokemon for a total of ${stats[0].totalSubs} subscriptions.`;
            bot.sendMessage({ to: userId, message: message });
        }).catch((err) => {
            bot.sendMessage({ to: userId, message: "Failed to get stats: " + err });
            logger.error(err);
        });
    }
}

/** 
Subscribes the specified user to the specified pokemon.
*/
function addSub(userID, guildId, pokemon) {
    if (userID && pokemon) {
        sql.run('INSERT INTO subcription (userId, guildId, pokemon) VALUES (?, ?, ?)', [userID, guildId, pokemon.toUpperCase()]).then(() => {
            logger.info(userID + ' is now subscribed to ' + pokemon);
            bot.sendMessage({ to: userID, message: 'You are now subscribed to ' + pokemon });
        }).catch((err) => {
            logger.error('Failed to subscribe ' + userID + ' to ' + pokemon + ': ' + err);
            bot.sendMessage({ to: userID, message: 'Failed to subscribe you to ' + pokemon });
        });
    }
    else {
        logger.info(userID + ' did not provide a pokemon to subscribe to');
        bot.sendMessage({ to: userID, message: 'Please specify a pokemon to subscribe to' });
    }
}

/** 
Unsubscribes the specified user from the specified pokemon.
*/
function removeSub(userID, guildId, pokemon) {
    if (userID && guildId && pokemon) {
        sql.run('DELETE FROM subcription WHERE userId=? AND guildId=? AND pokemon=?', [userID, guildId, pokemon.toUpperCase()]).then(() => {
            logger.info(userID + ' is no longer subscribed to ' + pokemon);
            bot.sendMessage({ to: userID, message: 'You are no longer subscribed to ' + pokemon });
        }).catch((err) => {
            logger.error('Failed to unsubscribe ' + userID + ' from ' + pokemon + ': ' + err);
            bot.sendMessage({ to: userID, message: 'Failed to unsubscribe you from ' + pokemon });
        });
    }
    else {
        logger.info(userID + ' did not provide a pokemon to unsubscribe from');
        bot.sendMessage({ to: userID, message: 'Please specify a pokemon to unsubscribe from' });
    }
}

/** 
Returns a list of all subscriptions for the specified user.
*/
function listSubs(userID, guildId) {
    if (userID && guildId) {
        sql.all('SELECT * FROM subcription WHERE userId=? and guildId=?', [userID, guildId]).then((subs) => {
            pokemon = '';
            if (subs) {
                for(i = 0; i < subs.length; i++) {
                    if (pokemon.length != 0) {
                        pokemon += ', ';
                    }
                    pokemon += subs[i].pokemon;
                }
                logger.info(userID + ' is subscribed to ' + pokemon);
                bot.sendMessage({ to: userID, message: 'You are subscribed to ' + pokemon });
            }
            else {
                logger.info(userID + ' is not subscribed to any pokemon');
                bot.sendMessage({ to: userID, message: 'You are not subscribed to any pokemon yet' });
            }
        }).catch((err) => {
            logger.error('Failed to get subscriptions for ' + userID + ': ' + err);
            bot.sendMessage({ to: userID, message: 'Failed to get your subscriptions' });
        });
    }
}

/** 
Sleeps for the specified number of milliseconds.
*/
function sleep(time) {
    return new Promise((resolve) => setTimeout(resolve, time));
}

/** 
Queries the database for all users subscribed to the specified pokemon and then sends them a DM to
alert them of a spawn. The DM will include an image if one is provided.
*/
function notifySubs(pokemon, guildId, image) {
    if (pokemon && guildId) {
        sql.all('SELECT * FROM subcription WHERE guildId=? AND pokemon=?', [guildId, pokemon.toUpperCase()]).then((subs) => {
            if (subs) {
                for (i = 0; i < subs.length; i++) {
                    userId = subs[i].userId;
                    pokemon = subs[i].pokemon;
                    if (image) {
                        bot.sendMessage({ to: userId, message: pokemon + ' has spawned: ' + image });
                    }
                    else {
                        bot.sendMessage({ to: userId, message: pokemon + ' has spawned!' });
                    }
                }
                logger.info('Alerted ' + subs.length + ' people about ' + pokemon);
            }
            else {
                logger.info('No one cares about ' + pokemon);
            }
        }).catch((err) => {
            logger.error('Unable to get subscriptions for ' + pokemon + ': ' + err);
        });
    }
}

/** 
Initializes and opens a connection to the Sqlite database. If necessary, it will also create the required table(s).
*/
function initializeDB() {
    sql.open(dbFile).then(() => {
        sql.run('CREATE TABLE IF NOT EXISTS subcription (userId TEXT, guildId TEXT, pokemon TEXT)').then(() => {
            logger.info('Database Initialized');
        }).catch((err) => {
            logger.error('Unable to initialize database: ' + err);
        });
    }).catch(() => {
        logger.error('Unable to initialize database: ' + err);
    });
}