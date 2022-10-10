import * as admin from 'firebase-admin';

export type Timeslot = 'breakfast' | 'lunch' | 'tea';

export interface Company {
  name: string;
  inviteCode: string;
}

export interface User {
  name: string;
  position: string;
  companyId: string;
  introduction: string;
  profilePictureId: string; // ID in Firebase Cloud Storage
  preferredTimeslots: Timeslot[];
  isAvailable: boolean;
}

export interface Session {
  participantIds: string[];
  date: admin.firestore.Timestamp;
  timeslot: Timeslot;
  isCompleted: boolean;
}
