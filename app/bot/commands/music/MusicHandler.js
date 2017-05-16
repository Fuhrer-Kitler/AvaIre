/** @ignore */
const _ = require('lodash');

/**
 * Music Handler, allows for easy management of music and
 * voice using streams for Discord voice channels.
 */
class MusicHandler {

    /**
     * Setups and prepares the Music Handler.
     */
    constructor() {
        /**
         * The music queue.
         *
         * @type {Object}
         */
        this.queues = {};

        /**
         * The music volume for guilds.
         *
         * @type {Object}
         */
        this.volume = {};

        /**
         * The music playback state for guilds.
         *
         * @type {Object}
         */
        this.paused = {};

        /**
         * The channel id the music was requested in for the guilds.
         *
         * @type {Object}
         */
        this.channel = {};

        /**
         * The people who have voted to skip the current song.
         *
         * @type {Object}
         */
        this.voteskips = {};

        /**
         * A list of unnecessary properties that should be
         * removed if they're found in the song objects.
         *
         * @type {Array}
         */
        this.unnecessaryProperties = [
            'upload_date', 'description', 'manifest_url', 'dislike_count', 'season_number',
            'automatic_captions', 'average_rating', 'age_limit', 'annotations', 'filesize',
            'protocol', 'alt_title', 'subtitles', 'fulltitle', 'like_count', 'thumbnails',
            'display_id', 'requested_subtitles', 'start_time', 'playlist_id', 'format_id',
            'episode_number', 'categories', 'playlist_title', 'http_headers', 'thumbnail',
            'id', 'asr', 'abr', 'tbr', 'fps', 'series', 'formats', 'creator', 'playlist',
            '_filename', 'uploader', 'format_note', 'extractor', 'format', 'player_url',
            'tags', 'license', 'extractor_key', 'end_time', 'is_live', 'n_entries',
            'view_count', 'uploader_id', 'webpage_url_basename', 'playlist_index'
        ];
    }

    /**
     * Adds a song to the queue.
     *
     * @param {IMessage}  message  The Discordie message object.
     * @param {Object}    song     The requested song object.
     * @param {String}    link     The link to the song.
     */
    addToQueue(message, song, link) {
        if (!_.isObjectLike(this.queues[message.guild.id])) {
            this.queues[message.guild.id] = [];
        }

        song.link = link;
        song.playTime = 0;
        song.requester = message.author.id;
        song.duration = this.formatDuration(song.duration);

        song = this.prepareProperties(message, song);

        this.queues[message.guild.id].push(song);
    }

    /**
     * Gets the current music queue.
     *
     * @param  {IMessage} message  The Discordie message object.
     * @return {Object}
     */
    getQueue(message) {
        if (!_.isObjectLike(this.queues[message.guild.id])) {
            this.queues[message.guild.id] = [];
        }

        return this.queues[message.guild.id];
    }

    /**
     * Prepares the voice channel for music streaming by making sure the bot
     * is can and is connectet to the voice channel the user is connected
     * to, it returns a promise that is resolved when the bot has
     * successfully connected to the voice channel.
     *
     * @param  {IMessage}  message  The Discordie message object.
     * @return {Promise}
     */
    prepareVoice(message) {
        return new Promise((resolve, reject) => {
            if (this.isConnectedToVoice(message)) {
                return resolve();
            }

            if (message.member.getVoiceChannel() === null) {
                return this.gracefullReject(reject, 'commands.music.voice-required');
            }

            if (!app.permission.has(bot.User, message.member.getVoiceChannel(), 'voice.connect')) {
                return this.gracefullReject(reject, 'commands.music.missing-permissions', {
                    permission: 'Connect'
                });
            }

            if (!app.permission.has(bot.User, message.member.getVoiceChannel(), 'voice.speak')) {
                return this.gracefullReject(reject, 'commands.music.missing-permissions', {
                    permission: 'Speak'
                });
            }

            this.queues[message.guild.id] = [];
            message.member.getVoiceChannel().join().then(() => resolve());
        });
    }

    /**
     * Populates the global music properties and remove unnecessary song items.
     *
     * @param  {IMessage}  message  The Discordie message object.
     * @param  {Object}    song     The song object.
     * @return {Object}
     */
    prepareProperties(message, song) {
        let guildId = message.guild.id;

        if (!this.volume.hasOwnProperty(guildId)) {
            this.volume[guildId] = 50;
        }

        if (!this.paused.hasOwnProperty(guildId)) {
            this.paused[guildId] = false;
        }

        if (!this.channel.hasOwnProperty(guildId)) {
            this.channel[guildId] = message.channel.id;
        }

        if (!this.voteskips.hasOwnProperty(guildId)) {
            this.voteskips[guildId] = [];
        }

        this.unnecessaryProperties.forEach(property => {
            if (song.hasOwnProperty(property)) {
                delete song[property];
            }
        });

        return song;
    }

    /**
     * Loads the next song in the queue, if the queue is empty the voice
     * channel stream will be droped and the bot will disconnect.
     *
     * @param  {IMessage}  message       The Discordie message object.
     * @param  {Boolean}   sendMessages  Determines if the messages should be sent.
     * @return {Function}
     */
    next(message, sendMessages = true) {
        let connection = this.getVoiceConnection(message);

        if (connection !== undefined) {
            if (this.getQueue(message).length === 0) {
                this.forcefullyDeleteQueue(message.guild.id);

                if (sendMessages) {
                    app.envoyer.sendInfo(message, 'commands.music.end-of-queue').then(m => {
                        return app.scheduler.scheduleDelayedTask(() => m.delete(), 7500);
                    });
                }

                return connection.voiceConnection.disconnect();
            }

            let song = this.queues[message.guild.id][0];

            if (song.url === 'INVALID') {
                this.queues[message.guild.id].shift();

                return this.next(message, sendMessages);
            }

            this.voteskips[message.guild.id] = [];

            let encoder = connection.voiceConnection.createExternalEncoder({
                type: 'ffmpeg',
                format: 'pcm',
                source: song.url
            });

            let encoderStream = encoder.play();
            let queue = this.getQueue(message);

            encoderStream.resetTimestamp();
            encoderStream.removeAllListeners('timestamp');
            encoderStream.on('timestamp', time => {
                if (typeof queue[0] !== 'undefined') {
                    queue[0].playTime = Math.floor(time);
                }
            });

            let volume = this.volume[message.guild.id];
            connection.voiceConnection.getEncoder().setVolume(volume === undefined ? 50 : volume);

            if (sendMessages) {
                app.envoyer.sendInfo(message, 'commands.music.now-playing', {
                    title: song.title,
                    duration: this.formatDuration(song.duration),
                    link: song.link,
                    requester: song.requester
                });
            }

            encoder.once('end', () => {
                this.queues[message.guild.id].shift();
                return this.next(message, sendMessages);
            });
        }
    }

    /**
     * Sets the volume of the current stream for the provided guild.
     *
     * @param  {IMessage}  message  The Discordie message object.
     * @param  {Integer}   volume   The volume the stream should be set to.
     */
    setVolume(message, volume) {
        this.volume[message.guild.id] = volume;

        return this.getVoiceConnection(message)
                   .voiceConnection.getEncoder().setVolume(volume);
    }

    /**
     * Gets the current stream volume, if the guild isn't found in
     * the volume list the default(50) will be returned instead.
     *
     * @param  {IMessage}  message  The Discordie message object.
     * @return {Integer}
     */
    getVolume(message) {
        if (!this.volume.hasOwnProperty(message.guild.id)) {
            return 50;
        }
        return this.volume[message.guild.id];
    }

    /**
     * Sets the voteskip list of users who have voted to skip
     * the song currently playing for the given guild id.
     *
     * @param  {IMessage}  message    The Discordie message object.
     * @param  {Array}     voteskips  The array of user ids that voted.
     */
    setVoteSkips(message, voteskips) {
        this.voteskips[message.guild.id] = voteskips;
    }

    /**
     * Gets the voteskip array of users for the given guild id.
     *
     * @param  {IMessage}  message  The Discordie message object.
     * @return {Array}
     */
    getVoteSkips(message) {
        if (!this.voteskips.hasOwnProperty(message.guild.id)) {
            return [];
        }
        return this.voteskips[message.guild.id];
    }

    /**
     * Gets the id of the channel the music was requested in.
     *
     * @param  {IMessage}  message  The Discordie message object.
     * @return {String|undefined}
     */
    getChannelId(message) {
        return this.channel[message.guild.id];
    }

    /**
     * Checks if the bot is connected to a voice channel.
     *
     * @param  {IMessage}  message  The Discordie message object.
     * @return {Boolean}
     */
    isConnectedToVoice(message) {
        return this.getVoiceConnection(message) !== undefined;
    }

    /**
     * Checks to make sure the user is connected to the
     * same voice channel the bot is connected to.
     *
     * @param  {IMessage}  message  The Discordie message object.
     * @param  {IUser}     sender   The user who should used to check if they're in
     *                              the same voice channel as the bot.
     * @return {Boolean}
     */
    isInSameVoiceChannelAsBot(message, sender) {
        let voiceChannel = this.getBotVoiceChannel(message);

        if (voiceChannel === null) {
            // Something went really wrong here, we should be connected but the bot wasen't
            // found in any of the voice channels for the guild? What the fuck....
            return false;
        }

        for (let i in voiceChannel.members) {
            if (voiceChannel.members[i].id === sender.id) {
                return true;
            }
        }

        return false;
    }

    /**
     * Gets the voice channel the bot is connected to.
     *
     * @param  {IMessage}  message  The Discordie message object.
     * @return {IVoiceChannel|null}
     */
    getBotVoiceChannel(message) {
        for (let i in message.guild.voiceChannels) {
            let voiceChannel = message.guild.voiceChannels[i];

            for (let x in voiceChannel.members) {
                if (voiceChannel.members[x].id === bot.User.id) {
                    return voiceChannel;
                }
            }
        }

        return null;
    }

    /**
     * Sets the current paused state.
     *
     * @param  {IMessage}  message  The Discordie message object.
     * @param  {Boolean}   state    The pause state that should be set.
     */
    setPausedState(message, state) {
        this.paused[message.guild.id] = state;
    }

    /**
     * Returns the current paused state.
     *
     * @param  {IMessage}  message  The Discordie message object.
     * @return {Boolean}
     */
    isPaused(message) {
        if (this.paused.hasOwnProperty(message.guild.id)) {
            return this.paused[message.guild.id];
        }
        return false;
    }

    /**
     * Pauses the current stream.
     *
     * @param  {IMessage}  message  The Discordie message object.
     * @return {undefinded}
     */
    pauseStream(message) {
        this.setPausedState(message, true);

        return this.getVoiceConnection(message)
                   .voiceConnection
                   .getEncoderStream()
                   .cork();
    }

    /**
     * Unpauses the current stream.
     *
     * @param  {IMessage}  message  The Discordie message object.
     * @return {undefinded}
     */
    unpauseStream(message) {
        this.setPausedState(message, false);

        return this.getVoiceConnection(message)
                   .voiceConnection
                   .getEncoderStream()
                   .uncork();
    }

    /**
     * Gets the current voice connection, if no connection
     * is found undefined will be returned instead.
     *
     * @param  {IMessage}  message  The Discordie message object.
     * @return {VoiceConnectionInfo|undefined}
     */
    getVoiceConnection(message) {
        return bot.VoiceConnections.find(voice => {
            return voice.voiceSocket.guildId === message.guild.id;
        });
    }

    /**
     * Checks if the guild member has the DJ role.
     *
     * @param  {IGuildMember}  member The Discordie guild member object.
     * @return {Boolean}
     */
    userHasDJRole(member) {
        return member.roles.find(role => {
            return role.name.toUpperCase() === 'DJ';
        }) !== undefined;
    }

    /**
     * Formats the given duration to look nicer.
     *
     * @param  {String} duration  The duration that should be formatted.
     * @return {String}
     */
    formatDuration(duration) {
        let split = duration.split(':');

        for (let i = 1; i < split.length; i++) {
            if (split[i].length < 2) {
                split[i] = `0${split[i]}`;
            }
        }

        return split.join(':');
    }

    /**
     * Greacefully reject a promise.
     *
     * @param  {Function}  reject        The promise reject function.
     * @param  {String}    message       The message that should be used when the promise is rejeccted.
     * @param  {Object}    placeholders  The placeholders that should be formatted into the message.
     * @return {Promise}
     */
    gracefullReject(reject, message, placeholders = {}) {
        return reject({
            message,
            placeholders
        });
    }

    /**
     * Forcefully deletes the queue, volume, and
     * paused state of the parsed guilds data.
     *
     * @param {String}  guildId  The id of the guild that should be deleted.
     */
    forcefullyDeleteQueue(guildId) {
        delete this.voteskips[guildId];
        delete this.channel[guildId];
        delete this.queues[guildId];
        delete this.volume[guildId];
        delete this.paused[guildId];

        return true;
    }
}

module.exports = new MusicHandler;
