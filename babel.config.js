module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      '@babel/plugin-transform-optional-chaining',
      '@babel/plugin-transform-nullish-coalescing-operator',
      ['@babel/plugin-transform-class-properties', { loose: true }],
      '@babel/plugin-transform-logical-assignment-operators',
      'react-native-reanimated/plugin',
    ],
  };
};
