import * as WebSocket from 'ws';

import {
  broadcastOtsCommitFlippedToClients,
  OtsBroadcastClient,
  OtsBroadcastServer,
} from './ordpool-ots-flag';

function makeClient(opts: Partial<OtsBroadcastClient> = {}): OtsBroadcastClient & { send: jest.Mock } {
  return {
    readyState: WebSocket.OPEN,
    send: jest.fn(),
    ...opts,
  } as OtsBroadcastClient & { send: jest.Mock };
}

function makeServer(clients: OtsBroadcastClient[]): OtsBroadcastServer {
  return { clients };
}

describe('broadcastOtsCommitFlippedToClients — WS push on OTS poller flip', () => {

  it('sends {otsCommitFlipped: txid} to clients with matching track-tx', () => {
    const tracking = makeClient({ 'track-tx': 'aabb' });
    const elsewhere = makeClient({ 'track-tx': 'ccdd' });
    broadcastOtsCommitFlippedToClients([makeServer([tracking, elsewhere])], 'aabb');
    expect(tracking.send).toHaveBeenCalledTimes(1);
    expect(tracking.send).toHaveBeenCalledWith(JSON.stringify({ otsCommitFlipped: 'aabb' }));
    expect(elsewhere.send).not.toHaveBeenCalled();
  });

  it('sends to clients with the txid in their track-txs (plural) list', () => {
    const tracking = makeClient({ 'track-txs': ['xxxx', 'aabb', 'yyyy'] });
    const elsewhere = makeClient({ 'track-txs': ['zzzz'] });
    broadcastOtsCommitFlippedToClients([makeServer([tracking, elsewhere])], 'aabb');
    expect(tracking.send).toHaveBeenCalledWith(JSON.stringify({ otsCommitFlipped: 'aabb' }));
    expect(elsewhere.send).not.toHaveBeenCalled();
  });

  it('does NOT send to clients whose socket is not OPEN', () => {
    const closed = makeClient({ 'track-tx': 'aabb', readyState: WebSocket.CLOSED });
    const closing = makeClient({ 'track-tx': 'aabb', readyState: WebSocket.CLOSING });
    const open = makeClient({ 'track-tx': 'aabb', readyState: WebSocket.OPEN });
    broadcastOtsCommitFlippedToClients([makeServer([closed, closing, open])], 'aabb');
    expect(closed.send).not.toHaveBeenCalled();
    expect(closing.send).not.toHaveBeenCalled();
    expect(open.send).toHaveBeenCalled();
  });

  it('does NOT send to clients tracking unrelated txids', () => {
    const elsewhere = makeClient({ 'track-tx': 'ffff', 'track-txs': ['gggg', 'hhhh'] });
    broadcastOtsCommitFlippedToClients([makeServer([elsewhere])], 'aabb');
    expect(elsewhere.send).not.toHaveBeenCalled();
  });

  it('handles clients tracking nothing (no track-tx, no track-txs)', () => {
    const idle = makeClient({});
    broadcastOtsCommitFlippedToClients([makeServer([idle])], 'aabb');
    expect(idle.send).not.toHaveBeenCalled();
  });

  it('broadcasts across multiple servers', () => {
    const a = makeClient({ 'track-tx': 'aabb' });
    const b = makeClient({ 'track-tx': 'aabb' });
    broadcastOtsCommitFlippedToClients([makeServer([a]), makeServer([b])], 'aabb');
    expect(a.send).toHaveBeenCalled();
    expect(b.send).toHaveBeenCalled();
  });

  it('a throwing client.send does not block subsequent broadcasts', () => {
    const bad = makeClient({ 'track-tx': 'aabb' });
    bad.send.mockImplementation(() => { throw new Error('socket gone'); });
    const good = makeClient({ 'track-tx': 'aabb' });

    expect(() =>
      broadcastOtsCommitFlippedToClients([makeServer([bad, good])], 'aabb'),
    ).not.toThrow();
    expect(good.send).toHaveBeenCalled();
  });

  it('does nothing when given no servers', () => {
    expect(() => broadcastOtsCommitFlippedToClients([], 'aabb')).not.toThrow();
  });
});
