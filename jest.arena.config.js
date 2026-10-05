module.exports = {
  preset: 'jest-expo/web',
  testMatch: ['<rootDir>/tests-arena/**/*.test.{ts,tsx}'],
  // The Vercel serverless handlers are ESM (.mjs); let Babel transform them so
  // their resolvers can be unit tested alongside the app code.
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'mjs', 'json', 'node'],
  transform: {
    '^.+\\.mjs$': 'babel-jest',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|react-native-web|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|react-native-awesome-slider|use-debounce|@babel/runtime|expo-blur|expo-image|expo-modules-core)/)',
  ],
};

