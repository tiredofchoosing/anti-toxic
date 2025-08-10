const fetch = require('node-fetch')
const fs = require('fs');
const path = require('path');

module.exports = function AntiToxic(mod) {
    let blacklist = []
    let enabled = true
    let timer = null
    let attempts = 0
    const saveFileName = 'blacklist.json'
    const saveFilePath = path.join(mod.info.path, 'data', saveFileName)
    const api = 'http://178.250.154.7:8080/dungeons'

    loadFromFile(false)

    mod.game.initialize("me")
    mod.dispatch.addDefinition("C_MATCH_DEL", 1, path.join(mod.info.path, "defs", "C_MATCH_DEL.1.def"))

    mod.command.add(['antitoxic','atx'], {
        $default: printHelp,
        $none: printHelp,
        help: printHelp,
        add: registerName, // add [name]
        remove: unregisterName, // remove [name]
        on: enable, // on
        off: disable, // off
        list: showList, // list
        save: saveToFile, // save
        load: loadFromFile // load
    })

    function printHelp() {
        mod.command.message(`Commands:
<FONT COLOR="#FFFFFF">add [name]</FONT> = Add a character name to blacklist.
<FONT COLOR="#FFFFFF">remove [name]</FONT> = Remove character name from blacklist.
<FONT COLOR="#FFFFFF">on</FONT> = Enable module.
<FONT COLOR="#FFFFFF">off</FONT> = Disable module.
<FONT COLOR="#FFFFFF">list</FONT> = Show blacklist.
<FONT COLOR="#FFFFFF">save</FONT> = Save blacklist.
<FONT COLOR="#FFFFFF">load</FONT> = Load blacklist.`)
    }

    function registerName(...args) {
        if (args.length === 0) return

        let name = args[0]
        if (!blacklist.includes(name)) {
            blacklist.push(name)
            mod.command.message(`${name} has been blacklisted.`)
        }
        else {
            mod.command.message(`${name} is already blacklisted.`)
        }
    }

    function unregisterName(...args) {
        if (args.length === 0) return

        let name = args[0]
        if (blacklist.includes(name)) {
            blacklist.splice(blacklist.indexOf(name), 1)
            mod.command.message(`${name} was removed from the blacklist.`)
        }
        else {
            mod.command.message(`${name} is not found.`)
        }
    }

    function cancelQueue(dungeons, names) {
        const packet = {
            instances: dungeons.map(d => ({ id: d, type: 0 })),
        }
        mod.send('C_MATCH_DEL', 1, packet)
        mod.command.message(`<FONT COLOR="#FF2222">${names.join(', ')}</FONT> detected in the matching queue. Canceling ${packet.instances.length} dungeon(s).`)
    }

    function enable() {
        if (enabled) return

        enabled = true
        timer = (async function loop() {
            await monitorQueue();
            if (enabled) {
                return mod.setTimeout(loop, 2000);
            }
        })();
        mod.command.message('Module has been enabled.')
    }

    function disable() {
        if (!enabled) return

        enabled = false
        mod.clearTimeout(timer)
        timer = null
        mod.command.message('Module has been disabled.')
    }

    function showList() {
        mod.command.message('Blacklist: ' + blacklist.join(', '))
    }

    function saveToFile() {
        fs.writeFile(saveFilePath, JSON.stringify(blacklist), (err) => {
            if (err) {
                mod.command.message('Could not save the file.' + err)
            }
            else {
                mod.command.message('Successfully saved.')
            }
        })
    }

    function loadFromFile(isUser = true) {
        fs.access(saveFilePath, fs.constants.F_OK | fs.constants.R_OK, (err) => {
            if (err) {
                if (isUser) {
                    mod.command.message('Could not load the file.' + err)
                }
                return
            }

            fs.readFile(saveFilePath, 'utf8', (err, data) => {
                if (err) {
                    if (isUser) {
                        mod.command.message('Could not load the file.' + err)
                    }
                    return
                }
                blacklist = JSON.parse(data);
                if (isUser) {
                    mod.command.message('Successfully loaded.')
                }
            });
        })
    }
    
    // TODO
    // optimize - monitor only while in the matching queue
    // and only if player is solo or party leader
    async function monitorQueue() {
        const me = mod.game.me.name

        const response = await fetch(api);
        if (!response || !response.ok) {
            if (attempts++ === 4) {
                mod.command.message(`<FONT COLOR="#FF2222">Failed to fetch api after ${attempts} attempts.</FONT>`)
                disable()
            }
            return
        }
        attempts = 0

        const cancel = []
        const blacklisted = []
        const data = await response.json();
        for (let dungeonId in data) {
            const dungeon = data[dungeonId]

            let meInParty = false
            const names = dungeon.parties.map(party => Object.values(party.players).map(player => player.name))
            names.forEach(n => { if (n.includes(me)) { meInParty = true } })
            if (!meInParty) continue

            let myPartyIndex = -1
            for (let i = 0; i < dungeon.parties.length; i++) {
                const party = dungeon.parties[i]
                if (party.players && party.players.length > 0 && party.players[0].name === me) {
                    myPartyIndex = i
                    break
                }
            }

            if (myPartyIndex === -1) return

            for (let i = 0; i < dungeon.parties.length; i++) {
                if (i === myPartyIndex) continue;
                
                const party = dungeon.parties[i]
                if (!party.players) continue
                
                for (const player of party.players) {
                    if (blacklist.includes(player.name)) {
                        if (!cancel.includes(dungeonId)) {
                            cancel.push(dungeonId)
                        }
                        if (!blacklisted.includes(player.name)) {
                            blacklisted.push(player.name)
                        }
                        break
                    }
                }
            }
        }

        if (cancel.length > 0) {
            cancelQueue(cancel, blacklisted)
        }
    }

    if (enabled) {
        timer = (async function loop() {
            await monitorQueue();
            if (enabled) {
                return mod.setTimeout(loop, 2000);
            }
        })();
    }
}