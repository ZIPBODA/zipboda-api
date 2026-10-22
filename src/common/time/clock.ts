import { Injectable } from '@nestjs/common';

/** 지금 시각을 주입받게 한다 — 공고 상태·D-day가 날짜에 따라 바뀌어, 테스트가 날마다 결과를 바꾸지 않게 */
export abstract class Clock {
  abstract now(): Date;
}

@Injectable()
export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
