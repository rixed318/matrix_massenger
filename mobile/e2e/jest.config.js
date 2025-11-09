module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/?(*.)+(e2e).[tj]s?(x)'],
  setupFilesAfterEnv: ['./setup.ts'],
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
  },
};
