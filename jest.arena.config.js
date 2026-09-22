module.exports = {
  preset: 'jest-expo/web',
  testMatch: ['<rootDir>/tests-arena/**/*.test.tsx'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|react-native-web|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|react-native-awesome-slider|use-debounce|@babel/runtime)/)',
  ],
};
