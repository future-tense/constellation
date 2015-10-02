#Constellation

A signature aggregator for multi-party transactions in Stellar

With all the great power that comes with multi-signatures and transaction
envelopes in Stellar, it's not uncommon to have transactions that need to
be signed off on by multiple parties. Constellation solves the problem of
passing around signing requests, and keeping track off who has signed,
so you don't have to.

For now, the server listens to commands in regular HTTP, and uses
Server Sent Events to send push notifications to interested users.
