import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

type FlightEventType = 'created' | 'updated' | 'deleted';

export type FlightSseEvent = {
  type: FlightEventType;
  payload: unknown;
};

@Injectable()
export class FlightsEventsService {
  private readonly subject = new Subject<FlightSseEvent>();

  stream(): Observable<FlightSseEvent> {
    return this.subject.asObservable();
  }

  publish(event: FlightSseEvent): void {
    this.subject.next(event);
  }
}
