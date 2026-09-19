const { fromContext, findRow, planWrite, reconcile, withRetries } = require('../../scripts/_lib/reconcile.js');
const { parseArgs, mask } = require('../../scripts/reconcile.js');

const T0 = new Date('2026-09-19T17:00:00Z');
const noSleep = () => Promise.resolve();

function reply(body) {
  return { inbound: { Body: body } };
}

// An execution context as trigger-send starts it: parameters arrive as flow.data.
function restContext({ answers = {}, closed = false, data = {} } = {}) {
  const widgets = {};
  for (const [q, body] of Object.entries(answers)) widgets[`${q.toUpperCase()}_Send`] = reply(body);
  if (closed) widgets.Closing_Save = { parsed: { ok: true } };
  return {
    flow: { data: { phone: '+15550000001', name: 'Ada', event: 'Gala', respondent_id: 'rid-1', ...data } },
    contact: { channel: { address: '+15550000001' } },
    widgets,
  };
}

const execution = (sid = 'FN1', updated = T0) => ({ sid, dateUpdated: updated, contactChannelAddress: '+15550000001' });

describe('fromContext', () => {
  it('reads a REST-started execution from flow.data and the reply widgets', () => {
    const record = fromContext(execution(), restContext({ answers: { q1: '3', q2: '4' } }));

    expect(record).toMatchObject({
      respondentId: 'rid-1',
      phone: '+15550000001',
      event: 'Gala',
      answers: { q1: '3', q2: '4' },
      completed: false,
    });
  });

  it('reads a text-in execution from the Lookup_Contact result', () => {
    const context = {
      flow: {},
      contact: { channel: { address: '+15550000001' } },
      widgets: {
        Lookup_Contact: { parsed: { phone: '+1 (555) 000-0001', event: 'unknown', respondent_id: 'rid-x' } },
        Q1_Send: reply('2'),
      },
    };

    expect(fromContext(execution(), context)).toMatchObject({
      respondentId: 'rid-x',
      phone: '+1 (555) 000-0001',
      event: 'unknown',
      answers: { q1: '2' },
    });
  });

  it('ignores blank replies, and marks an execution that reached Closing_Save as completed', () => {
    const record = fromContext(execution(), restContext({ answers: { q1: '3', q2: '   ' }, closed: true }));

    expect(record.answers).toEqual({ q1: '3' });
    expect(record.completed).toBe(true);
  });

  it('falls back to the channel address when nothing else carries a phone', () => {
    const context = { flow: {}, contact: { channel: { address: '+15550009999' } }, widgets: {} };

    expect(fromContext(execution(), context).phone).toBe('+15550009999');
  });
});

describe('findRow', () => {
  const rows = [{ phone: '+1‭5550000001‬', q1: '' }, { phone: '+15550000002' }];

  it('prefers the exact stored string', () => {
    expect(findRow(rows, '+15550000002')).toBe(rows[1]);
  });

  it('finds the same number stored in another format', () => {
    expect(findRow(rows, '+15550000001')).toBe(rows[0]);
    expect(findRow([{ phone: '(555) 000-0003' }], '+15550000003')).toBeDefined();
  });

  it('does not match on a short or absent number', () => {
    expect(findRow(rows, '')).toBeUndefined();
    expect(findRow(rows, '+123')).toBeUndefined();
  });
});

describe('planWrite', () => {
  const record = (overrides) => fromContext(execution(), restContext(overrides));

  it('fills answers the sheet is missing, keyed on the row\'s own stored phone', () => {
    const row = { phone: '+1‭5550000001‬', respondent_id: 'rid-1', q1: '3', q2: '' };

    const plan = planWrite(record({ answers: { q1: '3', q2: '4' } }), row);

    expect(plan.missing).toEqual(['q2']);
    expect(plan.params.phone).toBe(row.phone);
    expect(plan.params).toMatchObject({ respondent_id: 'rid-1', event: 'Gala', q1: '3', q2: '4' });
  });

  it('writes nothing when the sheet already has every answer', () => {
    const row = { phone: '+15550000001', respondent_id: 'rid-1', q1: '3', q2: '4', last_updated_at: 'x' };

    expect(planWrite(record({ answers: { q1: '3', q2: '4' } }), row).skip).toBe('already complete');
  });

  it('creates the row (all answers) when the contact is not on the sheet at all', () => {
    const plan = planWrite(record({ answers: { q1: '3' } }), undefined);

    expect(plan.params).toMatchObject({ phone: '+15550000001', respondent_id: 'rid-1', q1: '3' });
    expect(plan.params.last_updated_at).toBe(T0.toISOString());
  });

  it('never overwrites a value that differs from the sheet, but still fills the rest', () => {
    const row = { phone: '+15550000001', respondent_id: 'rid-1', q1: 'edited by hand', q2: '' };

    const plan = planWrite(record({ answers: { q1: '3', q2: '4' } }), row);

    expect(plan.conflicts).toEqual(['q1']);
    expect(plan.params).not.toHaveProperty('q1');
    expect(plan.params.q2).toBe('4');
  });

  it('reports a difference as left alone when there is nothing else to write', () => {
    const row = { phone: '+15550000001', respondent_id: 'rid-1', q1: 'edited', last_updated_at: 'x' };

    const plan = planWrite(record({ answers: { q1: '3' } }), row);

    expect(plan.skip).toMatch(/differ/);
    expect(plan.conflicts).toEqual(['q1']);
  });

  it('skips an execution superseded by a newer send (different respondent_id on the row)', () => {
    const row = { phone: '+15550000001', respondent_id: 'rid-NEWER', q1: '' };

    expect(planWrite(record({ answers: { q1: '3' } }), row).skip).toMatch(/newer send/);
  });

  it('skips executions with no respondent_id, no phone, or no answers', () => {
    expect(planWrite(record({ answers: { q1: '3' }, data: { respondent_id: '' } }), undefined).skip).toMatch(/respondent_id/);
    expect(planWrite(record({ answers: {} }), undefined).skip).toMatch(/no answers/);
    const noPhone = { ...record({ answers: { q1: '3' } }), phone: '' };
    expect(planWrite(noPhone, undefined).skip).toMatch(/phone/);
  });

  it('adds completed_at for a finished survey whose row lacks it, and not when it has one', () => {
    const done = record({ answers: { q1: '3' }, closed: true });

    expect(planWrite(done, { phone: 'p', respondent_id: 'rid-1', q1: '3' }).params.completed_at).toBe(T0.toISOString());
    expect(planWrite(done, { phone: 'p', respondent_id: 'rid-1', q1: '3', completed_at: 'x', last_updated_at: 'y' }).skip).toBe(
      'already complete'
    );
  });

  it('with all=true re-sends an execution that already looks complete (to repair the anonymous sheet)', () => {
    const row = { phone: '+15550000001', respondent_id: 'rid-1', q1: '3', last_updated_at: 'x' };

    const plan = planWrite(record({ answers: { q1: '3' } }), row, { all: true });

    expect(plan.params).toMatchObject({ respondent_id: 'rid-1', q1: '3' });
  });
});

describe('withRetries', () => {
  it('retries a failing call and returns the first success', async () => {
    const fn = jest.fn().mockRejectedValueOnce(new Error('a')).mockRejectedValueOnce(new Error('b')).mockResolvedValue('ok');

    await expect(withRetries(fn, { sleep: noSleep })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('gives up after the last attempt', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('down'));

    await expect(withRetries(fn, { sleep: noSleep })).rejects.toThrow('down');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe('reconcile', () => {
  function setup({ executions, contexts, sheet }) {
    const contextFor = (sid) => ({ executionContext: () => ({ fetch: async () => ({ context: contexts[sid] }) }) });
    const flow = { executions: Object.assign(contextFor, { list: jest.fn().mockResolvedValue(executions) }) };
    const client = { studio: { v2: { flows: () => flow } } };
    const callAppsScript = jest.fn(async (ctx, action) => {
      if (action === 'list_rows') return { rows: sheet.map((values, i) => ({ rowNumber: i + 2, values })) };
      return { ok: true };
    });
    return { client, callAppsScript };
  }

  const base = (deps, extra = {}) =>
    reconcile({ flowSid: 'FW1', appsScriptContext: {}, sleep: noSleep, ...deps, ...extra });

  it('a dry run reports what it would write and writes nothing', async () => {
    const deps = setup({
      executions: [execution('FN1')],
      contexts: { FN1: restContext({ answers: { q1: '3', q2: '4' } }) },
      sheet: [{ phone: '+15550000001', respondent_id: 'rid-1', q1: '3' }],
    });

    const summary = await base(deps);

    expect(summary.written).toHaveLength(1);
    expect(summary.written[0].filled).toEqual(['q2']);
    expect(deps.callAppsScript.mock.calls.map((c) => c[1])).toEqual(['list_rows']);
  });

  it('with apply, writes the missing answers through save_response', async () => {
    const deps = setup({
      executions: [execution('FN1')],
      contexts: { FN1: restContext({ answers: { q1: '3', q2: '4' }, closed: true }) },
      sheet: [{ phone: '+15550000001', respondent_id: 'rid-1', q1: '3' }],
    });

    const summary = await base(deps, { apply: true });

    const write = deps.callAppsScript.mock.calls.find((c) => c[1] === 'save_response');
    expect(write[2]).toMatchObject({ phone: '+15550000001', respondent_id: 'rid-1', q1: '3', q2: '4' });
    expect(write[2].completed_at).toBe(T0.toISOString());
    expect(summary.written).toHaveLength(1);
    expect(summary.failed).toEqual([]);
  });

  it('retries a failed write, and reports one that keeps failing without stopping the rest', async () => {
    const deps = setup({
      executions: [execution('FN1'), execution('FN2')],
      contexts: {
        FN1: restContext({ answers: { q1: '3' }, data: { phone: '+15550000001', respondent_id: 'rid-1' } }),
        FN2: restContext({ answers: { q1: '1' }, data: { phone: '+15550000002', respondent_id: 'rid-2' } }),
      },
      sheet: [],
    });
    deps.callAppsScript.mockImplementation(async (ctx, action, params) => {
      if (action === 'list_rows') return { rows: [] };
      if (params.respondent_id === 'rid-1') throw new Error('Apps Script down');
      return { ok: true };
    });

    const summary = await base(deps, { apply: true });

    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0].error).toMatch(/Apps Script down/);
    expect(summary.written).toHaveLength(1);
    expect(deps.callAppsScript.mock.calls.filter((c) => c[2].respondent_id === 'rid-1' && c[1] === 'save_response')).toHaveLength(3);
  });

  it('judges the older execution for a contact against the newer one it just planned, and skips it', async () => {
    const deps = setup({
      // newest first, as Twilio lists them
      executions: [execution('FNnew'), execution('FNold')],
      contexts: {
        FNnew: restContext({ answers: { q1: '1' }, data: { respondent_id: 'rid-new' } }),
        FNold: restContext({ answers: { q1: '5' }, data: { respondent_id: 'rid-old' } }),
      },
      sheet: [],
    });

    const summary = await base(deps);

    expect(summary.written.map((w) => w.executionSid)).toEqual(['FNnew']);
    expect(summary.skipped[0].reason).toMatch(/newer send/);
  });

  it('passes --since to Twilio as a creation-date filter', async () => {
    const deps = setup({ executions: [], contexts: {}, sheet: [] });

    await base(deps, { since: '2026-09-01' });

    const list = deps.client.studio.v2.flows().executions.list;
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ dateCreatedFrom: new Date('2026-09-01') }));
  });
});

describe('script helpers', () => {
  it('parses the flags, and rejects a bad --since date', () => {
    expect(parseArgs(['--apply', '--all', '--since', '2026-09-01'])).toEqual({ apply: true, all: true, since: '2026-09-01' });
    expect(parseArgs([])).toEqual({ apply: false, all: false });
    expect(() => parseArgs(['--since', 'not-a-date'])).toThrow(/--since/);
  });

  it('masks a phone number down to its last four digits', () => {
    expect(mask('+1‭3142107659‬')).toBe('…7659');
  });
});
