module.exports = {
  apps: [{
    name: 'bayles',
    script: 'dist/index.js',
    max_memory_restart: '300M',
    node_args: '--max-old-space-size=300',
  }],
};
