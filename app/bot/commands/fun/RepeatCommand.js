/** @ignore */
const Command = require('./../Command');

class RepeatCommand extends Command {

    /**
     * Sets up the command by providing the prefix, command trigger, any
     * aliases the command might have and additional options that
     * might be usfull for the abstract command class.
     */
    constructor() {
        super('repeat', ['echo'], {
            description: 'I will repeat anything you say.',
            usage: '[message]',
            middleware: [
                'throttle.user:2,4'
            ]
        });
    }

    /**
     * Executes the given command.
     *
     * @param  {IUser}     sender   The Discordie user object that ran the command.
     * @param  {IMessage}  message  The Discordie message object that triggered the command.
     * @param  {Array}     args     The arguments that was parsed to the command.
     * @return {mixed}
     */
    onCommand(sender, message, args) {
        if (args.length === 0) {
            return this.sendMissingArguments(message);
        }

        if (message.isPrivate) {
            return app.envoyer.sendNormalMessage(message, args.join(' '));
        }

        return app.envoyer.sendNormalMessage(message, args.join(' '));
    }
}

module.exports = RepeatCommand;