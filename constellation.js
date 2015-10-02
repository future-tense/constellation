/* global require, module, Buffer */

(function () {
	'use strict';

	var axios = require('axios');
	var EventSource = require('eventsource');
	var stellar = require('stellar-sdk');

	function Server(config) {

		var baseUrl = config.url;
		var subs = [];

		/**
		 * Submits a signature to the signature server
		 *
		 * @param tx
		 * @param key
		 * @returns {*}
		 */
		function submitSignature(tx, key) {

			var hash = tx.hash();
			var data = {
				sig: key.signDecorated(hash).toXDR().toString('base64')
			};

			return axios.put(
				baseUrl + '/transaction/' + hash.toString('hex'),
				data
			);
		}

		/**
		 * Submits a transaction to the signature server
		 *
		 * @param tx -
		 * @param msg
		 * @returns {*}
		 */
		function submitTransaction(tx, msg) {
			var data = {
				txenv: tx.toEnvelope().toXDR().toString('base64')
			};

			if (msg) {
				data.msg = msg;
			}

			return axios.post(
				baseUrl + '/transaction',
				data
			);
		}

		/**
		 * Subscribe to push notifications for a specific address.
		 *
		 * @param address - The address to subscribe for events
		 * @param requestFunc
		 * @param progressFunc
		 */
		function subscribe(address, requestFunc, progressFunc) {

			function progressCommon(status) {
				if (progressFunc) {
					progressFunc(JSON.parse(new Buffer(status, 'base64').toString()));
				}
			}

			function requestHandler(e) {
				var payload = JSON.parse(e.data);
				var tx = new stellar.Transaction(payload.txenv);
				if (requestFunc) {
					requestFunc(tx, payload.msg);
				}
				progressCommon(payload.progress);
			}

			function progressHandler(e) {
				var payload = JSON.parse(e.data);
				progressCommon(payload.progress);
			}

			var evtSource = new EventSource(baseUrl + '/events/' + address);
			evtSource.addEventListener('request', requestHandler, false);
			evtSource.addEventListener('progress', progressHandler, false);
			subs.push(evtSource);
		}

		return {
			submitSignature: submitSignature,
			submitTransaction: submitTransaction,
			subscribe: subscribe
		};
	}

	module.exports = {
		Server: Server
	};

})();