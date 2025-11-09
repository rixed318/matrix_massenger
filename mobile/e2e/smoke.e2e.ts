import { by, element, expect } from 'detox';

describe('Matrix Messenger Mobile', () => {
  it('показывает экран логина', async () => {
    await expect(element(by.text('Matrix Messenger'))).toBeVisible();
    await expect(element(by.text('Войдите в свой аккаунт Matrix'))).toBeVisible();
  });

  it('позволяет ввести учетные данные', async () => {
    await element(by.placeholder('https://matrix.example.com')).replaceText('https://matrix-client.matrix.org');
    await element(by.placeholder('@user:example.com')).replaceText('@user:example.com');
    await element(by.placeholder('••••••••')).replaceText('secret');
  });
});
