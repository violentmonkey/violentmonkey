const {
  ACTION_BUILD_URL,
  DISCORD_WEBHOOK_RELEASE,
  ERROR,
  MESSAGE,
  RELEASE_NAME,
  TARGET,
  VERSION,
} = process.env;

const success = !ERROR;
let message = MESSAGE || '';
if (message.length > 500) message = message.slice(0, 500) + '...';
const messageLines = message.split('\n').filter(Boolean);

if (!TARGET) {
  console.error('TARGET is not set');
  process.exit(1);
}

if (!RELEASE_NAME) {
  console.error('RELEASE_NAME is not set');
  process.exit(1);
}

if (DISCORD_WEBHOOK_RELEASE) {
  let title, description;
  if (success) {
    title = `${TARGET} Release Success: ${RELEASE_NAME}`;
    description = [
      ...messageLines.map((line) => `> ${line}`),
      `See the changelog at https://github.com/violentmonkey/violentmonkey/releases/tag/v${VERSION}.`,
    ].join('\n');
  } else {
    title = `${TARGET} Release Failure: ${RELEASE_NAME}`;
    description = [
      'An error occurred:',
      '',
      ...messageLines.map((line) => `> ${line}`),
      ...(ACTION_BUILD_URL
        ? ['', `See ${ACTION_BUILD_URL} for more details.`]
        : []),
    ].join('\n');
  }

  const res = await fetch(DISCORD_WEBHOOK_RELEASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embeds: [
        {
          title,
          description,
          color: success ? 0x00ff00 : 0xff0000,
        },
      ],
    }),
  });

  if (!res.ok) {
    console.error(res);
    process.exit(1);
  }
} else {
  console.warn('DISCORD_WEBHOOK_RELEASE is not available!');
}

process.exit(success ? 0 : 1);
