/* global require, console */

(function () {
	'use strict';

	var stellar = require('stellar-sdk');
	var constellation = require('./constellation.js');

	var server = new stellar.Server({
		hostname: 'horizon-testnet.stellar.org',
		port: 443,
		secure: true
	});
	stellar.Network.useTestNet();

	var signatureServer = new constellation.Server({
		url: 'http://localhost:4711'
	});

	//
	//
	//

	var SEED2 = 'SBLPFIGRZ33UKDAPEYPSSSEWUILKU43KPAYTSLANQP5LYH2HY327CNKX';	//GDWTLDVDTAGZ7AVM2SXZNBBHUPBA42WDCMPGB7TIRSEQSICZ5WMD33QY
	var holder = stellar.Keypair.fromSeed(SEED2);
	var holderAddress = holder.address();

	//
	// Subscribe to notifications for holderAddress
	//

	function request(tx, msg) {
		console.log('signing request');
		if (msg) {
			console.log(msg);
		}

		signatureServer.submitSignature(tx, holder)
		.then(console.log)
		.catch(console.log);
	}

	function progress(status) {
		console.log('signing progress');
		console.log(status);
	}

	signatureServer.subscribe(holderAddress, request, progress);

})();
