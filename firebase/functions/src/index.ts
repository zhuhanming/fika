import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { Session, Timeslot, User } from './types';
import { createSession } from './session';

admin.initializeApp();

const userCollection = admin.firestore().collection('users');
const sessionCollection = admin.firestore().collection('sessions');

// Listens for newly created users and try to match them with someone for their first session.
export const matchNewUser = functions.firestore
  .document('users/{userId}')
  .onCreate(async () => {
    try {
      await admin.firestore().runTransaction(async (transaction) => {
        return matchUniqueUsers(transaction);
      });
    } catch (error) {
      functions.logger.error(error);
    }
  });

// Listens for users who have updated their preferred timeslots and try to match them with someone.
export const matchUpdatedUser = functions.firestore
  .document('users/{userId}')
  .onUpdate(async (snap) => {
    const userBefore = snap.before.data() as User;
    const userAfter = snap.after.data() as User;

    // We won't bother handling the update if it isn't a change to their preferences
    if (
      userBefore.preferredTimeslots.length ===
        userAfter.preferredTimeslots.length &&
      userBefore.preferredTimeslots.every((t) =>
        userAfter.preferredTimeslots.includes(t),
      )
    ) {
      return;
    }

    // Even if it's a change to preferences, if they're not available, we also don't
    // bother trying to pair them.
    if (!userAfter.isAvailable) {
      return;
    }

    try {
      await admin.firestore().runTransaction(async (transaction) => {
        return matchUniqueUsers(transaction);
      });
    } catch (error) {
      functions.logger.error(error);
    }
  });

// Listens for changes to sessions, which would usually be sessions being completed.
// Upon which, we will try to match the now-unmatched users with others.
export const matchCompletedUser = functions.firestore
  .document('sessions/{sessionId}')
  .onUpdate(async (snap) => {
    const sessionBefore = snap.before.data() as Session;
    const sessionAfter = snap.after.data() as Session;

    // We ignore this update if the session wasn't updated to be completed.
    if (
      sessionBefore.isCompleted === sessionAfter.isCompleted ||
      !sessionAfter.isCompleted
    ) {
      return;
    }

    try {
      await admin.firestore().runTransaction(async (transaction) => {
        transaction.update(userCollection.doc(sessionAfter.participantIds[0]), {
          isAvailable: true,
        });
        transaction.update(userCollection.doc(sessionAfter.participantIds[1]), {
          isAvailable: true,
        });
      });
      await admin.firestore().runTransaction(async (transaction) => {
        return matchUniqueUsers(transaction);
      });
    } catch (error) {
      functions.logger.error(error);
    }
  });

const matchUniqueUsers = async (
  transaction: admin.firestore.Transaction,
): Promise<void> => {
  const promises = [
    transaction.get(userCollection.where('isAvailable', '==', true)),
    // TODO: Find a way to optimise this highly inefficient sessions query
    transaction.get(sessionCollection.where('isCompleted', '==', true)),
  ];
  return Promise.all(promises).then(([users, sessions]) => {
    const userIds = new Set(users.docs.map((d) => d.id));

    // We first find out all the past pairings where two currently unmatched people are involved
    const relevantSessions = sessions.docs.filter((d) =>
      d.data().participantIds.every((id: string) => userIds.has(id)),
    );
    const previouslyMatched = new Map<string, Set<string>>();
    relevantSessions.forEach((s) => {
      const participantIds = s.data().participantIds;
      if (!previouslyMatched.has(participantIds[0])) {
        previouslyMatched.set(participantIds[0], new Set());
      }
      if (!previouslyMatched.has(participantIds[1])) {
        previouslyMatched.set(participantIds[1], new Set());
      }
      previouslyMatched.get(participantIds[0])?.add(participantIds[1]);
      previouslyMatched.get(participantIds[1])?.add(participantIds[0]);
    });

    // We then slot people into the different timeslots that they can make it for
    const timeslotToUsers = new Map<Timeslot, (User & { id: string })[]>();
    timeslotToUsers.set('breakfast', []);
    timeslotToUsers.set('lunch', []);
    timeslotToUsers.set('tea', []);
    users.forEach((u) => {
      const user = u.data();
      user.preferredTimeslots.forEach((t: Timeslot) =>
        timeslotToUsers.get(t)?.push({ ...(user as User), id: u.id }),
      );
    });

    // Now, we do the matching, starting from the timeslot with the least number of people
    const alreadyMatched = new Set<string>();
    [...timeslotToUsers.entries()]
      .sort((a, b) => a[1].length - b[1].length)
      .forEach(([timeslot, users]) => {
        users.forEach((user, index) => {
          if (alreadyMatched.has(user.id)) {
            return;
          }
          // We do a naive matching, where we just seek for the next available
          // user that we can match with
          for (let i = index + 1; i < users.length; i += 1) {
            const otherUser = users[i];
            if (
              alreadyMatched.has(otherUser.id) ||
              user.companyId !== otherUser.companyId ||
              previouslyMatched.get(user.id)?.has(otherUser.id)
            ) {
              continue;
            }
            alreadyMatched.add(user.id);
            alreadyMatched.add(otherUser.id);
            transaction.update(userCollection.doc(user.id), {
              isAvailable: false,
            });
            transaction.update(userCollection.doc(otherUser.id), {
              isAvailable: false,
            });
            transaction.create(
              sessionCollection.doc(),
              createSession([user.id, otherUser.id], timeslot),
            );
            break;
          }
        });
      });
  });
};
