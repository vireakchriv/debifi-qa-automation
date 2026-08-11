/**
 * Test user data generation.
 *
 * Each test creates its own unique user at runtime, so tests never share state
 * and never collide with each other, even when run concurrently or repeatedly.
 *
 * Strategy: email = qa_auto_{timestamp}_{random}@test.com
 * The timestamp alone would be unique in sequential runs; the random suffix
 * adds safety for any future parallel execution.
 */
export type TestUser = {
  email: string;
  password: string;
};

export function generateUser(): TestUser {
  const id = `${Date.now()}_${Math.floor(Math.random() * 9999)}`;
  return {
    email: `qa_auto_${id}@test.com`,
    password: 'TestPassword1!', // meets Devise 6-character minimum
  };
}
