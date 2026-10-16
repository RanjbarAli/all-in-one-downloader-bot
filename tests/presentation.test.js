import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanText,
  username,
  mediaCaption,
  ownerCaption,
  pagination,
} from "../tgcloud/lib/presentation.js";
test("caption decoding handles the reported @ entity and double encoding", () => {
  const raw =
    "Ali Asadimofrad (&amp;#064;ali_lionandsun) &bull; Instagram photos and videos";
  assert.equal(
    cleanText(raw),
    "Ali Asadimofrad (@ali_lionandsun) • Instagram photos and videos",
  );
  assert.equal(
    mediaCaption({ title: raw, source: "https://www.instagram.com/p/POST/" }),
    "@ali_lionandsun\nhttps://www.instagram.com/p/POST/",
  );
});
test("captions keep Persian text and remove only unsafe control characters", () => {
  assert.equal(
    cleanText("می\u200cخواهم\u202e &#x40;name"),
    "می\u200cخواهم @name",
  );
});
test("owner captions include verified handle, ID and source, with no invented handle", () => {
  assert.equal(
    ownerCaption({
      username: "itsAliRanjbar",
      userId: 792399936,
      source: "https://w3.org/a.jpg",
    }),
    "@itsAliRanjbar\nID: 792399936\nhttps://w3.org/a.jpg",
  );
  assert.equal(
    ownerCaption({ username: "", userId: 123, source: "https://w3.org/a.jpg" }),
    "ID: 123\nhttps://w3.org/a.jpg",
  );
  assert.equal(username("@good_name"), "good_name");
  assert.equal(username("bad name"), "");
});
test("pagination supports thousands of pages, exact next numbers and final partial page", () => {
  assert.deepEqual(pagination(10003, 0), {
    offset: 0,
    page: 1,
    pages: 2001,
    total: 10003,
    previous: null,
    next: 5,
  });
  assert.deepEqual(pagination(10003, 10000), {
    offset: 10000,
    page: 2001,
    pages: 2001,
    total: 10003,
    previous: 9995,
    next: null,
  });
  assert.equal(pagination(1000000, 999999).page, 200000);
  assert.equal(pagination(7, 1000000).offset, 5);
  assert.equal(pagination(0).pages, 1);
  assert.throws(() => pagination(4, -1));
});

test("activity payloads keep legacy media readable and store new username metadata without a schema change", async () => {
  const { activityPayload, encodeActivity } = await import(
    "../tgcloud/lib/presentation.js"
  );
  const file = { fileId: "old-file", type: "photo" };
  assert.deepEqual(activityPayload(JSON.stringify([file])), {
    username: "",
    files: [file],
  });
  assert.deepEqual(activityPayload(encodeActivity([file], "person")), {
    username: "person",
    files: [file],
  });
});
