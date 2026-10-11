import { Injectable } from "@nestjs/common";

// WHY: time is an injected dependency so a test passes a fake with `useValue` and no global timer is touched.
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}
