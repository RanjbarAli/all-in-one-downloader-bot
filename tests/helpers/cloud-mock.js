// In-memory SDK substitute for bot-flow tests. No real Telegram/network calls.
export const dbSource = `
function column(){const c={};for(const k of ['primaryKey','notNull','default','unique'])c[k]=()=>c;return c;}
export const integer=column,text=column;
export function table(name,cols){const t={name};for(const [key,c] of Object.entries(cols))t[key]={key,table:name};return t;}
export const index=()=>({on(){}});
export const eq=(col,value)=>({col,value});
export const gt=(col,value)=>({col,value,op:"gt"}),lt=(col,value)=>({col,value,op:"lt"}),lte=(col,value)=>({col,value,op:"lte"});
export const and=(...conditions)=>({conditions});
export const desc=col=>({col,direction:-1}),asc=col=>({col,direction:1});
export const sql=(strings,...values)=>({strings,values});
`;
export const sdkSource = `
export const fetch=(...args)=>globalThis.cloudMock.fetch(...args);
export const api=new Proxy({}, {get:(_,method)=>(...args)=>globalThis.cloudMock.api(method,...args)});
export const db=new Proxy({}, {get:(_,method)=>(...args)=>globalThis.cloudMock.db[method](...args)});
export class InputFile{constructor(bytes,name,options){this.bytes=bytes;this.name=name;this.options=options;}}
`;
const matches = (row, c) => {
  if (!c || c.strings) return true;
  if (c.conditions) return c.conditions.every((x) => matches(row, x));
  const v = row[c.col.key];
  return c.op === "gt"
    ? v > c.value
    : c.op === "lt"
      ? v < c.value
      : c.op === "lte"
        ? v <= c.value
        : v === c.value;
};
export function mockCloud(html) {
  const records = { activity: [], users: [], locks: [] };
  const calls = [];
  const attempts = [];
  const media = [];
  const db = {
    async run() {
      return { rowsAffected: 1 };
    },
    insert(table) {
      let value,
        returning = false;
      const builder = {
        values(v) {
          value = v;
          return builder;
        },
        returning() {
          returning = true;
          return builder;
        },
        async run() {
          const row = { id: records[table.name].length + 1, ...value };
          records[table.name].push(row);
          return returning ? [row] : { rowsAffected: 1 };
        },
      };
      return builder;
    },
    update(table) {
      let value, condition;
      const b = {
        set(v) {
          value = v;
          return b;
        },
        where(c) {
          condition = c;
          return b;
        },
        async run() {
          for (const row of records[table.name])
            if (matches(row, condition)) Object.assign(row, value);
          return { rowsAffected: 1 };
        },
      };
      return b;
    },
    async $count(table, condition) {
      return records[table.name].filter((row) => matches(row, condition))
        .length;
    },
    select() {
      let table,
        condition,
        order = [],
        offset = 0,
        limit = Infinity;
      const b = {
        from(t) {
          table = t;
          return b;
        },
        where(c) {
          condition = c;
          return b;
        },
        orderBy(...value) {
          order = value;
          return b;
        },
        offset(value) {
          offset = value;
          return b;
        },
        limit(value) {
          limit = value;
          return b;
        },
        async all() {
          let rows = records[table.name].filter((r) => matches(r, condition));
          for (const o of order.slice().reverse())
            rows.sort((a, z) => (a[o.col.key] - z[o.col.key]) * o.direction);
          return rows.slice(offset, offset + limit);
        },
        async get() {
          return (await b.all())[0];
        },
      };
      return b;
    },
  };
  const response = (url, type, body) => ({
    ok: true,
    status: 200,
    url,
    headers: {
      get(k) {
        return k === "content-type"
          ? type
          : k === "content-length"
            ? String(body.length)
            : null;
      },
    },
    body: (async function* () {
      yield typeof body === "string" ? new TextEncoder().encode(body) : body;
    })(),
  });
  const cloud = {
    records,
    calls,
    attempts,
    media,
    db,
    failOnce: null,
    async fetch(url) {
      if (url.startsWith("https://www.instagram.com/"))
        return response(url, "text/html", html);
      return response(
        url,
        url.includes(".mp4") ? "video/mp4" : "image/jpeg",
        new Uint8Array(20),
      );
    },
    async api(method, params) {
      calls.push({ method, params });
      if (
        ["sendPhoto", "sendVideo", "sendDocument", "sendAudio"].includes(method)
      ) {
        const type = method.replace("send", "").toLowerCase();
        attempts.push(params[type]);
        if (cloud.failOnce === params[type]) {
          cloud.failOnce = null;
          throw Object.assign(new Error("Temporary Telegram failure"), {
            code: 500,
          });
        }
        media.push({ type, value: params[type] });
        const item = {
          file_id: "cached-" + media.length,
          file_size: 20,
          width: 1080,
          height: 1350,
        };
        return type === "photo" ? { photo: [item] } : { [type]: item };
      }
      return { message_id: calls.length };
    },
  };
  return cloud;
}
