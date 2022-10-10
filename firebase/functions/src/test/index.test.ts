import * as admin from 'firebase-admin';
import * as assert from 'assert';
import firebaseTest from 'firebase-functions-test';
import { FeaturesList } from 'firebase-functions-test/lib/features';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const test: FeaturesList = firebaseTest(
  {
    projectId: 'fika-test-b6cf3',
  },
  './fika-test-b6cf3-firebase-adminsdk-tu5uw-8337bc9f72.json',
);

import * as myFunctions from '../index';
import { User } from '../types';

describe('Users', function () {
  const baseUserData: Omit<User, 'name' | 'preferredTimeslots'> = {
    position: 'Software Engineer',
    companyId: '1',
    introduction: '',
    profilePictureId: '',
    isAvailable: true,
  };
  const user1: User = {
    ...baseUserData,
    name: 'testUser1',
    preferredTimeslots: ['breakfast'],
  };
  const user2: User = {
    ...baseUserData,
    name: 'testUser2',
    preferredTimeslots: ['breakfast', 'lunch'],
  };
  const user3: User = {
    ...baseUserData,
    name: 'testUser2',
    preferredTimeslots: ['breakfast'],
  };
  const user4: User = {
    ...baseUserData,
    name: 'testUser2',
    preferredTimeslots: ['tea'],
  };

  describe('matchNewUser', function () {
    it('should not match when the first user is created', async function () {
      // We will first actually create the document, else the triggered function won't work.
      const createdUser = await admin
        .firestore()
        .collection('users')
        .add(user1);
      const path = `users/${createdUser.id}`;
      const snap = test.firestore.makeDocumentSnapshot(user1, path);
      const wrapped = test.wrap(myFunctions.matchNewUser);
      await wrapped(snap).then(async () => {
        const user = (await admin.firestore().doc(path).get())?.data();
        assert.equal(user?.isAvailable, true);
        assert.equal(user?.name, user1.name); // Sanity check
      });
    });

    it('should match when the second user is created', async function () {
      // We will first actually create the document, else the triggered function won't work.
      const createdUser = await admin
        .firestore()
        .collection('users')
        .add(user2);
      const path = `users/${createdUser.id}`;
      const snap = test.firestore.makeDocumentSnapshot(user2, path);
      const wrapped = test.wrap(myFunctions.matchNewUser);
      await wrapped(snap).then(async () => {
        const user = (await admin.firestore().doc(path).get())?.data();
        assert.equal(user?.isAvailable, false);
        assert.equal(user?.name, user2.name); // Sanity check

        const sessions = await admin
          .firestore()
          .collection('sessions')
          .where('participantIds', 'array-contains', createdUser.id)
          .where('isCompleted', '==', false)
          .get();
        assert.equal(sessions.docs.length, 1);
        const session = sessions.docs[0].data();
        assert.ok(user?.preferredTimeslots?.includes(session.timeslot));

        const otherUserId = session.participantIds.filter(
          (id: string) => id !== createdUser.id,
        );
        const otherUser = (
          await admin.firestore().doc(`users/${otherUserId}`).get()
        )?.data();
        assert.equal(otherUser?.isAvailable, false);
        assert.ok(otherUser?.preferredTimeslots?.includes(session.timeslot));
      });
    });

    it("should not match when there's no available users", async function () {
      // We will first actually create the document, else the triggered function won't work.
      const createdUser = await admin
        .firestore()
        .collection('users')
        .add(user3);
      const path = `users/${createdUser.id}`;
      const snap = test.firestore.makeDocumentSnapshot(user3, path);
      const wrapped = test.wrap(myFunctions.matchNewUser);
      await wrapped(snap).then(async () => {
        const user = (await admin.firestore().doc(path).get())?.data();
        assert.equal(user?.isAvailable, true);
        assert.equal(user?.name, user3.name); // Sanity check
      });
    });

    it("should not match when there's no available users with overlapping preferred timeslots", async function () {
      // We will first actually create the document, else the triggered function won't work.
      const createdUser = await admin
        .firestore()
        .collection('users')
        .add(user4);
      const path = `users/${createdUser.id}`;
      const snap = test.firestore.makeDocumentSnapshot(user4, path);
      const wrapped = test.wrap(myFunctions.matchNewUser);
      await wrapped(snap).then(async () => {
        const user = (await admin.firestore().doc(path).get())?.data();
        assert.equal(user?.isAvailable, true);
        assert.equal(user?.name, user4.name); // Sanity check
      });
    });

    after(async function () {
      await admin
        .firestore()
        .recursiveDelete(admin.firestore().collection('users'));
      await admin
        .firestore()
        .recursiveDelete(admin.firestore().collection('sessions'));
      test.cleanup();
    });
  });
});
