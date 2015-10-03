/* global require, console, process, Buffer */

(function () {
	'use strict';

	var stellar = require('stellar-sdk');
	var express = require('express');
	var bodyParser = require('body-parser');
	var redis = require('redis');
	var Promise = require("bluebird");

	//

	var server = new stellar.Server({
		hostname: 'horizon-testnet.stellar.org',
		port: 443,
		secure: true
	});
	stellar.Network.useTestNet();

	var redisClient = redis.createClient();
	redisClient.select(process.env.REDIS_DB);

	/**
	 * Returns an object with all the source accounts of a transaction,
	 * and their corresponding threshold categories
	 *
	 * @param tx
	 * @returns {{}}
	 */
	function getSourceAccounts(tx) {

		function getOperationCategory(op) {
			var category = 1;
			if (op.type === 'setOptions') {
				if (op.masterWeight || op.lowThreshold || op.medThreshold || op.highThreshold || op.signer) {
					category = 2;
				}
			} else if (op.type === 'allowTrust') {
				category = 0;
			}
			return category;
		}

		function getSourceAccount(op, tx) {
			if (op.source) {
				return op.source;
			} else {
				return tx.source;
			}
		}

		function setAccountCategory(accounts, source, category) {
			if (!accounts[source]) {
				accounts[source] = [0, 0, 0];
			}
			accounts[source][category] = 1;
		}

		var accounts = {};
		tx.operations.forEach(function (op) {
			var category = getOperationCategory(op);
			var source = getSourceAccount(op, tx);
			setAccountCategory(accounts, source, category);
		});

		return accounts;
	}

	/**
	 * Returns an array of promises for account information
	 *
	 * @param accounts - The array of accounts to get account information for
	 * @returns {Array}
	 */
	function getAccountPromises(accounts) {
		var promises = [];
		for (var account in accounts) {
			if (accounts.hasOwnProperty(account)) {
				promises.push(server.accounts().address(account).call());
			}
		}
		return promises;
	}

	function initProgress(accounts, sourceAccounts) {

		var names = [
			'low_threshold',
			'med_threshold',
			'high_threshold'
		];

		var progress = {};

		accounts.forEach(function (account) {
			var key = account.address;

			var thresholds = [];
			for (var i = 0; i < 3; i++) {
				thresholds.push(
					account.thresholds[names[i]] * sourceAccounts[key][i]
				);
			}

			var threshold = Math.max.apply(null, thresholds);
			if (threshold === 0) {
				threshold = 1;
			}

			progress[key] = {
				threshold: threshold,
				weight: 0
			};
		});

		return progress;
	}

	function initState(accounts, sourceAccounts) {

		var source = {};
		accounts.forEach(function (account) {
			account.signers.forEach(function (signer) {
				var address = signer.address;
				if (!signer[address]) {
					source[address] = [];
				}
				source[address].push({
					address: account.address,
					weight: signer.weight
				});
			});
		});

		var address = {};
		for (var key in source) {
			if (source.hasOwnProperty(key)) {
				var hint = stellar.Keypair.fromAddress(key).signatureHint().toString('hex');
				address[hint] = key;
			}
		}

		return {
			address: address,
			source: source,
			progress: initProgress(accounts, sourceAccounts),
			signatures: []
		};
	}

	/**
	 * Verify all the supplied transaction signatures and
	 * check if they are all valid
	 *
	 * @param signatures - An array of signatures to verify
	 * @param hash - The hash of the transaction
	 * @param state
	 * @returns {boolean} - True iff all signatures are valid
	 */
	function hasValidSignatures(signatures, hash, state) {
		var msg = new Buffer(hash, 'hex');
		return signatures.every(function (sig) {
			var hint = sig.hint().toString('hex');
			var address = state.address[hint];
			var key = stellar.Keypair.fromAddress(address);
			return key.verify(msg, sig.signature());
		});
	}

	/**
	 * Update signing weights for the source accounts that *signatures* sign for
	 * and add *signatures* to the internal list of signatures that have signed
	 *
	 * @param signatures - An array of signatures
	 * @param state
	 */
	function updateState(signatures, state) {
		signatures.forEach(function (sig) {
			var hint = sig.hint().toString('hex');
			var address = state.address[hint];
			var sources = state.source[address];
			sources.forEach(function (source) {
				state.progress[address].weight += source.weight;
			});

			state.signatures.push(sig.toXDR().toString('base64'));
		//	delete state.source[address];
		});
	}

	/**
	 * Check all the signing thresholds for source accounts of
	 * this transaction to see if they are fulfilled
	 *
	 * @param state
	 * @returns {boolean}
	 */
	function hasEnoughSignatures(state) {
		var accounts = [];
		Object.keys(state.progress).forEach(function (key) {
			accounts.push(state.progress[key]);
		});

		return accounts.every(function (account) {
			return (account.weight >= account.threshold);
		});
	}

	/**
	 *
	 * @param tx
	 * @param state
	 * @returns {*}
	 */
	function submitTransaction(tx, state) {

		tx.signatures = [];
		state.signatures.forEach(function (sig) {
			var buffer = new Buffer(sig, 'base64');
			var signature = stellar.xdr.DecoratedSignature.fromXDR(buffer);
			tx.signatures.push(signature);
		});

		return server.submitTransaction(tx);
	}

	/**
	 *
	 * @param txenv
	 * @param msg
	 * @param state
	 */
	function broadcastSigningRequest(txenv, msg, state) {
		Object.keys(state.source).forEach(function (address) {

			var progress = new Buffer(
				JSON.stringify(state.progress)
			).toString('base64');

			var payload = {
				command: 'request',
				txenv: txenv,
				progress: progress
			};

			if (msg) {
				payload.msg = msg;
			}

			redisClient.publish(address, JSON.stringify(payload));
		});
	}

	/**
	 *
	 * @param state
	 */
	function broadcastProgress(state) {
		Object.keys(state.source).forEach(function (address) {

			var progress = new Buffer(
				JSON.stringify(state.progress)
			).toString('base64');

			var payload = JSON.stringify({
				command: 'progress',
				progress: progress
			});

			redisClient.publish(address, payload);
		});
	}

	//

	var serverEvent = function (res) {
		res.writeHead(200, {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			'Connection': 'keep-alive'
		});
		res.write('\n');

		return {
			send: function(name, data, id) {
				res.write('event: ' + name + '\n');
				if (id) {
					res.write('id: ' + id + '\n');
				}
				res.write('data: ' + JSON.stringify(data) + '\n\n');
			}
		};
	};

	//

	var app = express();
	app.use(bodyParser.json());

	app.get('/events/:address', function (req, res) {
		var address = req.params.address;

		var clientSub = redis.createClient();
		clientSub.select(process.env.REDIS_DB);

		var sse = serverEvent(res);
		clientSub.on('message', function (channel, message) {
			message = JSON.parse(message);
			var command = message.command;
			delete message.command;

			sse.send(command, message);
		});

		req.on('close', function () {
			clientSub.unsubscribe(address);
		});

		clientSub.subscribe(address);
	});

	//	submit

	app.post('/transaction', function (req, res) {

		console.log('submit');

		var txenv = req.body.txenv;
		var tx = new stellar.Transaction(txenv);
		var hash = tx.hash().toString('hex');

		var sourceAccounts = getSourceAccounts(tx);
		var promises = getAccountPromises(sourceAccounts);

		Promise.all(promises)
		.then(function (accounts) {

			var state = initState(accounts, sourceAccounts);
			if (hasValidSignatures(tx.signatures, hash, state)) {
				updateState(tx.signatures, state);

				if (hasEnoughSignatures(state)) {
					submitTransaction(tx, state)
					.then(console.log)
					.catch(console.log);
					console.log('submitted');
				} else {
					var data = {
						txenv: txenv,
						msg: req.body.msg,
						state: JSON.stringify(state)
					};

					if (req.body.msg) {
						data.msg = req.body.msg;
					}

					redisClient.hmset(hash, data);

					broadcastSigningRequest(txenv, req.body.msg, state);
				}
			}
		});
	});

	//	sign
	app.put('/transaction/:hash', function (req, res) {

		console.log('sign');

		function getSignatures(sigs) {
			if (typeof sigs  === 'string') {
				sigs = [sigs];
			}

			return sigs.map(function (sig) {
				return stellar.xdr.DecoratedSignature
				.fromXDR(new Buffer(sig, 'base64'));
			});
		}

		var hash = req.params.hash;
		var signatures = getSignatures(req.body.sig);

		redisClient.hgetall(hash, function (err, res) {

			var state = JSON.parse(res.state);
			if (hasValidSignatures(signatures, hash, state)) {
				updateState(signatures, state);
			}

			if (hasEnoughSignatures(state)) {
				var tx = new stellar.Transaction(res.txenv);
				submitTransaction(tx, state)
				.then(function (res) {
					redisClient.del(hash);
					console.log(res);
				})
				.catch(console.log);
			} else {
				redisClient.hset(hash, 'state', JSON.stringify(state));
			}

			broadcastProgress(state);
		});
	});

/*
	//	cancel
	app.delete('/transaction/:hash', function (req, res) {
	});
*/

	app.listen(process.env.PORT);
})();
