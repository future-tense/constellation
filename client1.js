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

	var SEED1 = 'SAX3S2EJBRGLP52WQFY2M7NE2KQHKWXDEOBV3Y74LAQPPUIZHDLAKZ6R';	//GDYEMIORXQB2SXZ76LEJ3QQGHES73WNS5Y6MXNP4TS5ZDSHE6YT7JGJC
	var issuer = stellar.Keypair.fromSeed(SEED1);
	var issuerAddress = issuer.address();
	var holderAddress = 'GDWTLDVDTAGZ7AVM2SXZNBBHUPBA42WDCMPGB7TIRSEQSICZ5WMD33QY';
	var asset = new stellar.Asset('test', issuerAddress);

	//
	// Create and submit a complex transaction envelope
	// that needs signatures from both "issuer" and "holder"
	//
	// Sign for "issuer" and let the server take care of getting
	// the signature from "holder"
	//

	server.loadAccount(issuerAddress)
	.then(function (account) {
		var tx = new stellar.TransactionBuilder(account)
		.addOperation(stellar.Operation.setOptions({
			setFlags: 1
		}))
		.addOperation(stellar.Operation.changeTrust({
			source: holderAddress,
			asset: asset
		}))
		.addOperation(stellar.Operation.allowTrust({
			trustor: holderAddress,
			assetCode: asset.code,
			authorize: true
		}))
		.addOperation(stellar.Operation.payment({
			destination: holderAddress,
			amount: '10',
			asset: asset
		}))
		.addSigner(issuer)
		.build();

		return signatureServer.submitTransaction(tx, 'yo!');
	})
	.then(console.log)
	.catch(console.log);

})();
