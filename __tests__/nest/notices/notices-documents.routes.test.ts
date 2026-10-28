/**
 * Real production notice documents through the server's read path (spencer0124/skkuverse#61 option E, #68):
 * the documents in fixtures/prod-notice-documents.json, deserialized from Extended JSON into the BSON types the
 * driver hands over, are served by the list and detail routes, and every response parses with its published
 * wire schema. A drift between what the crawler stores and what the server types (an `articleNo` stored as a
 * string, a date shape the cursor refuses, a null where a string is published) fails here.
 *
 * The app boots the list and detail modules through the production pipeline; only their repositories are
 * doubles, typed fakes that apply the real reads' filters and projections. The clock is fixed.
 */
import fs from "fs";
import path from "path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { BSON } from "mongodb";
import request from "supertest";
import { BuildingRepository } from "../../../src/building/building.repository";
import { BuildingPlaceRepository } from "../../../src/building/place/building-place.repository";
import { Clock } from "../../../src/infra/clock";
import { NoticesDetailModule } from "../../../src/notices/detail/notices-detail.module";
import { NoticesDetailRepository } from "../../../src/notices/detail/notices-detail.repository";
import { noticeDetail } from "../../../src/notices/detail/notices-detail.wire";
import { NoticesListModule } from "../../../src/notices/list/notices-list.module";
import { NoticesListRepository } from "../../../src/notices/list/notices-list.repository";
import { noticeList } from "../../../src/notices/list/notices-list.wire";
import type { NoticeDoc } from "../../../src/notices/notices.document";
import { NoticesModule } from "../../../src/notices/notices.module";
import { RequestAuthenticator } from "../../../src/perimeter/perimeter.ports";
import { FakeRequestAuthenticator } from "../../helpers/fakes/perimeter/request-authenticator.fake";
import { expectWire } from "../../helpers/contracts/expect-wire";
import { FakeBuildingPlaceRepository } from "../../helpers/fakes/building/building-place.repository.fake";
import { FakeBuildingRepository } from "../../helpers/fakes/building/building.repository.fake";
import { FakeNoticesDetailRepository } from "../../helpers/fakes/notices/notices-detail.repository.fake";
import { FakeNoticesListRepository } from "../../helpers/fakes/notices/notices-list.repository.fake";
import { buildTestApp } from "../../helpers/nest/build-test-app";

const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/prod-notice-documents.json"), "utf8")) as { documents: unknown[] };
const documents = FIXTURE.documents.map((document) => BSON.EJSON.deserialize(document as BSON.Document, { relaxed: true }) as NoticeDoc);
const fakeClock: Clock = { now: () => new Date("2026-10-16T03:00:00.000Z") };

let app: NestExpressApplication;
let httpServer: import("http").Server;
const listRepository = new FakeNoticesListRepository();
const detailRepository = new FakeNoticesDetailRepository();

beforeAll(async () => {
  app = await buildTestApp({
    imports: [NoticesModule, NoticesListModule, NoticesDetailModule],
    overrides: [
      { provide: RequestAuthenticator, useValue: new FakeRequestAuthenticator() },
      { provide: NoticesListRepository, useValue: listRepository },
      { provide: NoticesDetailRepository, useValue: detailRepository },
      { provide: BuildingRepository, useValue: new FakeBuildingRepository() },
      { provide: BuildingPlaceRepository, useValue: new FakeBuildingPlaceRepository() },
      { provide: Clock, useValue: fakeClock },
    ],
    role: "api",
  });
  httpServer = app.getHttpServer();
  listRepository.docs = documents;
  detailRepository.docs = documents;
});

afterAll(async () => {
  await app.close();
});

describe("production notice documents", () => {
  it("deserialize into the types NoticeDoc declares for the fields every read uses", () => {
    // Act
    const shapes = documents.map((doc) => [typeof doc.articleNo, typeof doc.date, doc.crawledAt instanceof Date, doc._id instanceof BSON.ObjectId]);

    // Assert
    expect(shapes).toEqual(documents.map(() => ["number", "string", true, true]));
  });

  it("page through GET /notices one at a time, each page a published list body", async () => {
    // Arrange
    const sourceIds = [...new Set(documents.map((doc) => doc.sourceId))].join(",");
    const served: string[] = [];
    let cursor: string | null = null;

    // Act
    do {
      const query: string = `/notices?sourceIds=${sourceIds}&limit=1${cursor ? `&cursor=${cursor}` : ""}`;
      const res = await request(httpServer).get(query);
      expect(res.status).toBe(200);
      expectWire(noticeList, res.body.data);
      served.push(...res.body.data.notices.map((notice: { id: string }) => notice.id));
      cursor = res.body.data.nextCursor;
    } while (cursor !== null && served.length <= documents.length);

    // Assert
    expect([...served].sort()).toEqual(documents.map((doc) => doc._id.toHexString()).sort());
  });

  it.each(documents.map((doc) => [doc.sourceId, doc.articleNo] as const))(
    "serve GET /notices/%s/%s as a published detail body",
    async (sourceId, articleNo) => {
      // Act
      const res = await request(httpServer).get(`/notices/${sourceId}/${articleNo}`);

      // Assert
      expect(res.status).toBe(200);
      expectWire(noticeDetail, res.body.data);
      expect(res.body.data.articleNo).toBe(articleNo);
    },
  );
});
