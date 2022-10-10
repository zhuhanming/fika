import { Session, Timeslot } from './types';
import * as admin from 'firebase-admin';

export const createSession = (
  participantIds: string[],
  timeslot: Timeslot,
): Session => {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return {
    participantIds,
    date: admin.firestore.Timestamp.fromDate(date),
    timeslot,
    isCompleted: false,
  };
};
