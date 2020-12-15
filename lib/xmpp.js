const { client, xml, jid } = require("@xmpp/client");
const debug = require("@xmpp/debug");
var EventEmitter = require('events').EventEmitter;
var qbox = require('qbox');

var STATUS = {
    AWAY: "away",
    DND: "dnd",
    XA: "xa",
    ONLINE: "online",
    OFFLINE: "offline"
};

var NS_CHATSTATES = "http://jabber.org/protocol/chatstates";

function Xmpp() {
    //setting status here
    this.STATUS = STATUS;
    var self = this;
    var config;
    var conn;
    var probeBuddies = {};
    var joinedRooms = {};
    var capabilities = {};
    var capBuddies = {};
    var iqCallbacks = {};
    var $ = qbox.create();

    var events = new EventEmitter();
    this.on = function() {
        events.on.apply(events, Array.prototype.slice.call(arguments));
    };
    this.removeListener = function() {
        events.removeListener.apply(events, Array.prototype.slice.call(arguments));
    };

    this.events = events;
    this.conn = conn;

    this.send = function(to, message, group) {
        var stanza = xml('message', { to: to, type: (group ? 'groupchat' : 'chat') });
        stanza.c('body').t(message);
        conn.send(stanza);
    };

    this.join = function(to, password) {
        var room = to.split('/')[0];
        if(!joinedRooms[room]){
            joinedRooms[room] = true;
        }
        var stanza =  xml('presence', { to: to }).
        c('x', { xmlns: 'http://jabber.org/protocol/muc' });
        // XEP-0045 7.2.6 Password-Protected Rooms
        if (password !== null && password !== "")
            stanza.c('password').t(password);
        conn.send(stanza);
    };

    this.invite = function(to, room, reason) {
        var stanza =  xml('message', { to: room }).
        c('x', { xmlns: 'http://jabber.org/protocol/muc#user' }).
        c('invite', {to: to});
        if (reason)
            stanza.c('reason').t(reason);
        conn.send(stanza);
    }

    this.subscribe = function(to) {
        var stanza = xml('presence', { to: to, type: 'subscribe' });
        conn.send(stanza);
    };

    this.unsubscribe = function(to) {
        var stanza = xml('presence', { to: to, type: 'unsubscribe' });
        conn.send(stanza);
    };

    this.acceptSubscription = function(to) {

        // Send a 'subscribed' notification back to accept the incoming
        // subscription request
        var stanza = xml('presence', { to: to, type: 'subscribed' });
        conn.send(stanza);
    };

    this.acceptUnsubscription = function(to) {
        var stanza = xml('presence', { to: to, type: 'unsubscribed' });
        conn.send(stanza);
    };

    this.getRoster = function() {
        var roster = xml('iq', { id: 'roster_0', type: 'get' });
        roster.c('query', { xmlns: 'jabber:iq:roster' });
        conn.send(roster);
    };

    this.probe = function(buddy, callback) {
        probeBuddies[buddy] = true;
        var stanza = xml('presence', {type: 'probe', to: buddy});
        events.once('probe_' + buddy, callback);
        conn.send(stanza);
    };

    function parseVCard(vcard) {
        //it appears, that vcard could be null
        //in the case, no vcard is set yet, so to avoid crashing, just return null
        if (!vcard) {
            return null;
        }
        return vcard.children.reduce(function(jcard, child) {
            jcard[child.name.toLowerCase()] = (
                (typeof(child.children[0]) === 'object') ?
                    parseVCard(child) :
                    child.children.join('')
            );
            return jcard;
        }, {});
    }

    this.getVCard = function(buddy, callback) {
        var id = 'get-vcard-' + buddy.split('@').join('--');
        var stanza = xml('iq', { type: 'get', id: id }).
            c('vCard', { xmlns: 'vcard-temp' }).
            up();
        iqCallbacks[id] = function(response) {
            if(response.attrs.type === 'error') {
                callback(null);
            } else {
                callback(parseVCard(response.children[0]));
            }
        };
        conn.send(stanza);
    };


   this.getVCardForUser = function(jid, user, callback) {
        var id = 'get-vcard-' + user.split('@').join('-');
        var stanza = xml('iq', { from: jid, type: 'get', id: id, to: user }).
            c('vCard', { xmlns: 'vcard-temp' }).
            up();
        iqCallbacks[id] = function(response) {
            if(response.attrs.type === 'error') {
                callback(null);
            } else {
                var responseObj = {
                    vcard: parseVCard(response.children[0]),
                    jid: jid,
                    user: user
                };
                callback(responseObj);
            }
        };
        conn.send(stanza);
    }

    // Method: setPresence
    //
    // Change presence appearance and set status message.
    //
    // Parameters:
    //   show     - <show/> value to send. Valid values are: ['away', 'chat', 'dnd', 'xa'].
    //              See http://conn.org/rfcs/rfc3921.html#rfc.section.2.2.2.1 for details.
    //              Pass anything that evaluates to 'false' to skip sending the <show/> element.
    //   status   - (optional) status string. This is free text.
    //   priority - (optional) priority integer. Ranges from -128 to 127.
    //              See http://conn.org/rfcs/rfc3921.html#rfc.section.2.2.2.3 for details.
    //
    // TODO:
    // * add caps support
    this.setPresence = function(show, status) {
        var stanza = xml('presence');
        if(show && show !== STATUS.ONLINE) {
            stanza.c('show').t(show);
        }
        if(typeof(status) !== 'undefined') {
            stanza.c('status').t(status);
        }
        if(typeof(priority) !== 'undefined') {
            if(typeof(priority) !== 'number') {
                priority = 0;
            } else if(priority < -128) {
                priority = -128;
            } else if(priority > 127) {
                priority = 127;
            }
            stanza.c('priority').t(parseInt(priority));
        }
        conn.send(stanza);
    };

    // Method: setChatstate
    //
    // Send current chatstate to the given recipient. Chatstates are defined in
    // <XEP-0085 at http://conn.org/extensions/xep-0085.html>.
    //
    // Parameters:
    //   to    - JID to send the chatstate to
    //   state - State to publish. One of: active, composing, paused, inactive, gone
    //
    // See XEP-0085 for details on the meaning of those states.
    this.setChatstate = function(to, state) {
        var stanza = xml('message', { to: to }).
            c(state, { xmlns: NS_CHATSTATES }).
            up();
        conn.send(stanza);
    };

    // TODO: document!
    //
    // Options:
    //   * skipPresence - don't send initial empty <presence/> when connecting
    //
    this.disconnect = async function () {
        conn.send(xml("presence", { type: "unavailable" }));
        events.emit('close', {message: 'Offline', jid: config})
	};

    this.parsingXmpp = (host, port=5222) => {
        if (port == 5222) {
            return `xmpp://${host}:${port}`
        } else if (port == 5223) {
            return `xmpps://${host}:${port}`
        } else {
            return null
        }
    }

    this.connect = (params) => {
        let service = this.parsingXmpp(params.host, params.port)
        if (!service) {
            events.emit('error', {message: 'Service Unavailable Only Support for port default 5222 (tcp) and 5223 (tls)', jid: params.jid})
            return;
        }

        let object = {
            service: service,
            domain: params.host,
            resource: params.jid.split("/")[1] || params.resource || '',
            username: params.jid.split('@')[0],
            password: params.password
        }

        config = params;
        conn = client(object);
        self.conn = conn;
        if (params.debug) {
            debug(conn, true);
        }
        
        conn.on("error", (err) => {
            console.error(err);
        });
        
        conn.on("offline", () => {
            console.log("offline");
        });
        
        conn.on("stanza", async (stanza) => {
            events.emit('stanza', stanza);
            //console.log(stanza);
            //looking for message stanza
            if (stanza.is('message')) {
                //getting the chat message
                if(stanza.attrs.type === 'chat') {

                    var body = stanza.getChild('body');
                    if(body) {
                        var message = body.getText();
                        events.emit('chat', stanza.attrs.from, message);
                    }

                    var chatstate = stanza.getChildByAttr('xmlns', NS_CHATSTATES);
                    if(chatstate) {
                        // Event: chatstate
                        //
                        // Emitted when an incoming <message/> with a chatstate notification
                        // is received.
                        //
                        // Event handler parameters:
                        //   jid   - the JID this chatstate noticiation originates from
                        //   state - new chatstate we're being notified about.
                        //
                        // See <Simpleconn#setChatstate> for details on chatstates.
                        //
                        events.emit('chatstate', stanza.attrs.from, chatstate.name);
                    }

                } else if (stanza.attrs.type == 'groupchat') {

                    var body = stanza.getChild('body');
                    if (body) {
                        var message = body.getText();
                        var from = stanza.attrs.from;
                        var conference = from.split('/')[0];
                        var id = from.split('/')[1];
                        var stamp = null;
                        var delay = null;
                        if(stanza.getChild('x') && stanza.getChild('x').attrs.stamp)
                            stamp = stanza.getChild('x').attrs.stamp;
                        if(stanza.getChild('delay')) {
                            delay = {
                                stamp: stanza.getChild('delay').attrs.stamp,
                                from_jid: stanza.getChild('delay').attrs.from_jid
                            };
                        }
                        events.emit('groupchat', conference, id, message, stamp, delay);
                    }
                }
            } else if (stanza.is('presence')) {
                var from = stanza.attrs.from;
                if (from) {
                  if (stanza.attrs.type == 'subscribe') {
                      //handling incoming subscription requests
                      events.emit('subscribe', from);
                  } else if (stanza.attrs.type == 'unsubscribe') {
                      //handling incoming unsubscription requests
                      events.emit('unsubscribe', from);
                  } else {
                      //looking for presence stanza for availability changes
                      var id = from.split('/')[0];
					  var resource = from.split('/')[1];
                      var statusText = stanza.getChildText('status');
                      var state = (stanza.getChild('show'))? stanza.getChild('show').getText(): STATUS.ONLINE;
                      state = (state == 'chat')? STATUS.ONLINE : state;
                      state = (stanza.attrs.type == 'unavailable')? STATUS.OFFLINE : state;
                      //checking if this is based on probe
                      if (probeBuddies[id]) {
                          events.emit('probe_' + id, state, statusText);
                          delete probeBuddies[id];
                      } else {
                          //specifying roster changes
                          if (joinedRooms[id]){
                            var groupBuddy = from.split('/')[1];
                            events.emit('groupbuddy', id, groupBuddy, state, statusText);
                          } else {
                            events.emit('buddy', id, state, statusText,resource);
                          }
                      }

                      // Check if capabilities are provided
                      var caps = stanza.getChild('c', 'http://jabber.org/protocol/caps');
                      if (caps) {
                          var node = caps.attrs.node,
                              ver = caps.attrs.ver;

                          if (ver) {
                              var fullNode = node + '#' + ver;
                              // Check if it's already been cached
                              if (capabilities[fullNode]) {
                                  events.emit('buddyCapabilities', id, capabilities[fullNode]);
                              } else {
                                  // Save this buddy so we can send the capability data when it arrives
                                  if (!capBuddies[fullNode]) {
                                      capBuddies[fullNode] = [];
                                  }
                                  capBuddies[fullNode].push(id);

                                  var getCaps = new Stanza('iq', { id: 'disco1', to: from, type: 'get' });
                                  getCaps.c('query', { xmlns: 'http://jabber.org/protocol/disco#info', node: fullNode });
                                  conn.send(getCaps);
                              }
                          }
                      }

                  }
                }
            } else if (stanza.is('iq')) {
                if (stanza.getChild('ping', 'urn:conn:ping')) {
                    conn.send(new Stanza('iq', { id: stanza.attrs.id, to: stanza.attrs.from, type: 'result' }));
                }
                // Response to capabilities request?
                else if (stanza.attrs.id === 'disco1') {
                    var query = stanza.getChild('query', 'http://jabber.org/protocol/disco#info');

                    // Ignore it if there's no <query> element - Not much we can do in this case!
                    if (!query) {
                        return;
                    }

                    var node = query.attrs.node,
                        identity = query.getChild('identity'),
                        features = query.getChildren('feature');

                    var result = {
                        clientName: identity && identity.attrs.name,
                        features: features.map(function (feature) { return feature.attrs['var']; })
                    };

                    capabilities[node] = result;

                    // Send it to all buddies that were waiting
                    if (capBuddies[node]) {
                        capBuddies[node].forEach(function (id) {
                            events.emit('buddyCapabilities', id, result);
                        });
                        delete capBuddies[node];
                    }
                }

                var cb = iqCallbacks[stanza.attrs.id];
                if(cb) {
                    cb(stanza);
                    delete iqCallbacks[stanza.attrs.id];
                }
            }
        });
        
        conn.on("online", async (address) => {
            // Makes itself available
            await conn.send(xml("presence"));
            events.emit('online', address)
            if(self.conn.socket) {
                self.conn.socket.setTimeout(0);
                self.conn.socket.setKeepAlive(true, 10000);
            }
        });
        
        conn.start().catch(console.error);          
    }
}
module.exports = new Xmpp();