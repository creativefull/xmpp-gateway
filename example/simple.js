const xmpp = require('./lib/xmpp')

xmpp.connect({
    jid: youraccount,
    host: hostname,
    password: password,
    port: port,
    debug: false
})

xmpp.on('online', function(data) {
	console.log('Connected with JID: ' + data);
    console.log('Yes, I\'m connected!');    
});

xmpp.on('error', console.error)
xmpp.on('close', function() {
	console.log('connection has been closed!');
});

xmpp.on('subscribe', (from) => {
    console.log('Request Pertemanan', from)
    xmpp.acceptSubscription(from);
})
xmpp.on('chat', (from, message) => {
    console.log(from, message)
})
xmpp.on('stanza', (stanza) => {
    // console.log(stanza)
})
xmpp.getRoster();