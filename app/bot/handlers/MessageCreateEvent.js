/** @ignore */
const _ = require('lodash');
/** @ignore */
const EventHandler = require('./EventHandler');
/** @ignore */
const GlobalMiddleware = require('./../middleware/global');
/** @ignore */
const CommandHandler = require('./../commands/CommandHandler');
/** @ignore */
const ProcessCommand = require('./../middleware/global/ProcessCommand');
/** @ignore */
const ChannelModule = require('./../commands/administration/utils/ChannelModule');

/**
 * Emitted when a user sends a text message in any valid text channel in a guild.
 *
 * @extends {EventHandler}
 */
class MessageCreateEvent extends EventHandler {

    /**
     * The event-handler that is executed by Discords event dispatcher.
     *
     * @param  {GatewaySocket} socket  The Discordie gateway socket
     * @return {mixed}
     */
    handle(socket) {
        // Checks if the message was sent from the bot itself, or another bot, if that's
        // the case we want to simply just end the event there, otherwise we'll end up
        // with an endless loop of messages going on and on and on and on and...
        if (bot.User.id === socket.message.author.id || socket.message.author.bot) {
            return;
        }

        // This will increment by one every time we get a message, this is used to
        // give a better idea of how many valid MessageCreate events are being
        // broadcasted to the bot during a session.
        app.bot.statistics.messages++;

        // Checks if the user who triggered the message event is on the bots blacklist,
        // if they are we're just going to ignore anything they're doing, preventing
        // them from using any features inside the bot.
        if (app.bot.features.blacklist.isBlacklisted(socket.message.author.id)) {
            return;
        }

        // Loads the guild and channel from the database so they can be used later.
        return ChannelModule.getChannel(socket.message).then(({guild, channel}) => {
            // Checks if the application process is ready to be used, if the process is not ready we'll
            // cancel out the rest of the event, the reason the check is placed after the event loads
            // the guild transformer from the database is because the transformers are cached and
            // ready to be used when they're needed after the application is ready for use.
            if (!app.process.isReady) {
                return;
            }

            // Checks if slowmode is enabled for the given channel in the current guild, if it
            // is enabled and the user has exceeded the message limit the users message will
            // be deleted without triggering any of the command or service logic.
            if (!socket.message.isPrivate && channel.get('slowmode.enabled', false) && !app.permission.requestHas(socket, 'text.manage_messages')) {
                let fingerprint = `slowmode.${app.getGuildIdFrom(socket)}.${socket.message.channel.id}.${socket.message.author.id}`;
                let limit = channel.get('slowmode.messagesPerLimit', 1);
                let decay = channel.get('slowmode.messageLimit', 5);

                if (!app.throttle.can(fingerprint, limit, decay)) {
                    return socket.message.delete();
                }
            }

            let message = socket.message.content;
            let command = CommandHandler.getCommand(socket.message, message);

            // Checks to see if a valid command was found from the message context, if a
            // command was found the onCommand method will be called for the handler.
            if (command !== null) {
                return this.processCommand(socket, command);
            }

            // Checks to see if the bot was tagged in the message the user
            // sent, either using the full username, or a nickname.
            if (message.hasBot()) {
                // If the bot was tagged in the message with no additional text/arguments
                // given we'll send the user some information about the bot, just to
                // let the user know that the bot is alive and how to use it.
                if (_.startsWith(message, '<@') && _.endsWith(message.trim(), `${bot.User.id}>`)) {
                    return this.sendTagInformationMessage(socket);
                }

                // Checks to see if the bot was tagged, followed by the word prefix, if both
                // are ture we'll parse any additional arguments to socket so they can be
                // picked up later by the Process Command middleware, and call the
                // Change Prefix Command for the current user.
                let parts = message.split(' ');
                if (this.isBotTaggedFollowedByPrefix(parts)) {
                    socket.processCommandProperties = {
                        args: parts
                    };

                    return this.processCommand(socket, {
                        command: app.bot.commands.ChangePrefixCommand
                    });
                }

                // Checks to see  if AI messages in enabled, if AI messages is
                // enabled the message will be passed onto the AI handler.
                if (channel.get('ai.enabled', false)) {
                    return app.service.ai.textRequest(socket, message);
                }
            }

            if (socket.message.isPrivate) {
                return this.sendInformationMessage(socket);
            }
        });
    }

    /**
     * Process command by building the middleware stack and running it.
     *
     * @param  {GatewaySocket} socket   The Discordie gateway socket
     * @param  {Command}       command  The command that should be executed
     * @return {mixed}
     */
    processCommand(socket, command) {
        if (!command.command.handler.getOptions('allowDM', true) && socket.message.isPrivate) {
            return app.envoyer.sendWarn(socket.message, 'language.errors.cant-run-in-dms');
        }

        let middlewareGroup = command.command.handler.getOptions('middleware', []);
        let stack = new ProcessCommand(undefined, [], command);
        let param = [];

        if (middlewareGroup.length === 0) {
            for (let index in GlobalMiddleware) {
                stack = new GlobalMiddleware[index](stack, param, command);
            }

            return stack.handle(socket, stack.next.bind(stack), ...param);
        }

        for (let index in middlewareGroup) {
            let split = middlewareGroup[index].split(':');

            let middleware = split[0];
            let args = [];

            if (!app.bot.middleware.hasOwnProperty(middleware)) {
                continue;
            }

            if (split.length > 1) {
                args = split[1].split(',');
            }

            stack = new app.bot.middleware[middleware](stack, param, command);
            param = args;
        }

        for (let index in GlobalMiddleware) {
            stack = new GlobalMiddleware[index](stack, param, command);
            param = [];
        }

        return stack.handle(socket, stack.next.bind(stack), ...param);
    }

    /**
     * Sends the information message about how to invite the bot and some basic
     * commands to the user, this method should ONLY be invoked in private
     * messages if the user typed something that wasen't a command,
     * otherwise there will just be too much spam everywhere.
     *
     * @param  {GatewaySocket} socket   The Discordie gateway socket
     * @return {Promise}
     */
    sendInformationMessage(socket) {
        let message = [
            'To invite me to your server, use this link:',
            '*:oauth*',
            '',
            'You can use `.help` to see a list of all the modules.',
            'You can use `.help module` to see a list of commands for that module.',
            'For specific command help, use `.help CommandName` (for example `.help !ping`)'
        ];

        if (app.service.ai.isEnabled) {
            message.push(`You can tag me in a message with <@${bot.User.id}> to send me a message that I should process using my AI`);
        }

        message.push(`\n**Full list of commands**\n*https://avairebot.com/docs/commands*`);

        message.push('\nAvaIre Support Server:\n*https://avairebot.com/support*');
        return app.envoyer.sendNormalMessage(socket.message, message.join('\n'), {
            oauth: app.config.bot.oauth
        });
    }
    /**
     * Sends the tag information message, this is only sent if the bot was
     * tagged in a message with no additional text/arguments given.
     *
     * @param  {GatewaySocket}  socket  The Discordie gateway socket
     * @return {Promise}
     */
    sendTagInformationMessage(socket) {
        let message = [
            'Hi there! I\'m :name, a multipurpose Discord bot built for fun!',
            'Here is a bit of(hopefully) helpful information.',
            '',
            '**Commands**',
            'You can use `:help` to to learn more about what commands I have.',
            '',
            '**Website**',
            'https://avairebot.com',
            '',
            '**Support Server**',
            'https://avairebot.com/support'
        ];

        return app.envoyer.sendInfo(socket.message, message.join('\n'), {
            name: bot.User.username,
            help: CommandHandler.getPrefix(socket.message, 'help') + 'help'
        });
    }

    /**
     * Checks to see if the bot is tagged, followed
     * by the word prefix, or prefix?
     *
     * @param  {[type]}  parts [description]
     * @return {Boolean}
     */
    isBotTaggedFollowedByPrefix(parts) {
        return parts.length > 1 &&
               _.startsWith(parts[0], '<@') &&
               (
                    parts[1].toLowerCase() === 'prefix' ||
                    parts[1].toLowerCase() === 'prefix?'
               );
    }
}

module.exports = new MessageCreateEvent;
