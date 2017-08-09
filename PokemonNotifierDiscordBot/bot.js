const Discord = require('discord.io');
const logger = require('winston');
const auth = require('./auth.json');
const sql = require('sqlite');

const dbFile = './subs.sqlite';

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

const supportedCommands = { 'ping': pong, 'sub': sub, 'db': db, 'spawn': spawn, 'help': help };

bot.on('ready', function (evt) {
    logger.info('Connected');
    logger.info('Logged in as: ' + bot.username + ' - (' + bot.id + ')');
});

bot.on('message', function (user, userID, channelID, message, evt) {
    // Our bot needs to know if it will execute a command
    // It will listen for messages that will start with `!`
    if (message.substring(0, 1) == '!') {
        logger.info('Command detected: ' + message);
        var args = message.substring(1).split(' ');
        var cmd = args[0];

        args = args.splice(1);
        f = supportedCommands[cmd];
        if (f) {
            f(user, userID, channelID, args, evt);
        }
        else {
            bot.sendMessage({to: channelID, message: 'Unknown command: ' + cmd + '. Use !help to see available commands.'});
        }
    }
});

function help(user, userID, channelID, args, evt) {
    message = 'Available commands:' +
        '\r\n!ping\r\n\tChecks to see if the bot is running' +
        '\r\n\r\n!sub <flag>\r\n\tPerform a subscription action. Requires one of the following flags:' +
        '\r\n\t\tadd <pokemon>: Add a subscription for the specified <pokemon>. You will receive a confirmation DM.' +
        '\r\n\t\tremove <pokemon>: Removes a subscription for the specified <pokemon>. You will receive a confirmation DM.' +
        '\r\n\t\tlist: Sends a DM with a list of all pokemon you are subscribed to.' +
        '\r\n\r\n!spawn <pokemon>\r\n\tSends a DM to all people subscribed to the specified <pokemon> indicating that one has spawned. If sent as a comment on an image, the uploaded image will also be included in the DM.'
    bot.sendMessage({ to: channelID, message: message });
}

function db(user, userID, channelID, args, evt) {
    initializeDB();
}

function pong(user, userID, channelID, args, evt) {
    bot.sendMessage({
        to: channelID,
        message: 'Pong!'
    });
};

function sub(user, userID, channelID, args, evt) {
    if (args) {
        flag = args[0];
        if ((flag === 'add' || flag === 'remove') && args.length >= 2) {
            pokemon = args[1];
            if (flag === 'add') {
                addSub(userID, pokemon);
            }
            else if (flag === 'remove') {
                removeSub(userID, pokemon);
            }
        }
        else if (flag === 'list' && args.length >= 1) {
            listSubs(userID);
        }
        else
        {
            bot.sendMessage({ to: channelID, message: 'Invalid usage' });
        }
    }
    else {
        bot.sendMessage({ to: channelID, message: 'Invalid usage' });
    }
};

function spawn(user, userID, channelID, args, evt) {
    if (args) {
        pokemon = args[0];
        var imageUrl = null;
        if (evt.d.attachments) {
            imageUrl = evt.d.attachments[0].proxy_url;
        }
        sleep(5000).then(() => { notifySubs(pokemon, imageUrl); });
        bot.sendMessage({ to: channelID, message: 'Sent out alerts for ' + pokemon });
    }
}

function addSub(userID, pokemon) {
    if (userID && pokemon) {
        sql.run('INSERT INTO subcription (userId, pokemon) VALUES (?, ?)', [userID, pokemon.toUpperCase()]).then(() => {
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

function removeSub(userID, pokemon) {
    if (userID && pokemon) {
        sql.run('DELETE FROM subcription WHERE userId=? AND pokemon=?', [userID, pokemon.toUpperCase()]).then(() => {
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

function listSubs(userID) {
    if (userID) {
        sql.all('SELECT * FROM subcription WHERE userId=?', [userID]).then((subs) => {
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

function sleep(time) {
    return new Promise((resolve) => setTimeout(resolve, time));
}

function notifySubs(pokemon, image) {
    if (pokemon) {
        sql.all('SELECT * FROM subcription WHERE pokemon=?', [pokemon.toUpperCase()]).then((subs) => {
            if (subs) {
                for (i = 0; i < subs.length; i++) {
                    userId = subs[i].userId;
                    pokemon = subs[i].pokemon;
                    logger.debug(userId + ' is interested in ' + pokemon);
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

function initializeDB() {
    sql.open(dbFile).then(() => {
        sql.run('CREATE TABLE IF NOT EXISTS subcription (userId TEXT, pokemon TEXT)').then(() => {
            logger.info('Database Initialized');
        }).catch((err) => {
            logger.error('Unable to initialize database: ' + err);
        });
    }).catch(() => {
        logger.error('Unable to initialize database: ' + err);
    });
}