module.exports = {
  preset: 'jest-expo/web',
  setupFiles: ['<rootDir>/jest.setup.arena.js'],
  testMatch: ['<rootDir>/tests-arena/**/*.test.{ts,tsx}'],
  // `api/*.mjs` (Vercel functions) ke pure helpers bhi test hote hain — babel
  // unhe default me transform nahi karta, isliye `.mjs` explicitly jodta hai.
  transform: {
    '^.+\\.(js|jsx|ts|tsx|mjs)$': 'babel-jest',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|react-native-web|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|react-native-awesome-slider|use-debounce|@babel/runtime|expo-blur|expo-image|expo-modules-core|expo-screen-orientation)/)',
  ],
};

