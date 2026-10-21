import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from './Modal';

describe('Modal', () => {
  it('タイトル・説明・本文を表示し、dialog として公開する', () => {
    render(
      <Modal title="テスト" subtitle="説明文" onClose={() => {}}>
        <p>本文</p>
      </Modal>
    );
    expect(screen.getByRole('dialog', { name: 'テスト' })).toBeInTheDocument();
    expect(screen.getByText('説明文')).toBeInTheDocument();
    expect(screen.getByText('本文')).toBeInTheDocument();
  });

  it('×ボタン・Escキー・背景クリックで閉じる', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <Modal title="テスト" onClose={onClose}>
        <p>本文</p>
      </Modal>
    );
    await user.click(screen.getByRole('button', { name: '閉じる' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
    await user.click(container.firstChild as HTMLElement); // 背景
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('カードの中のクリックでは閉じない', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Modal title="テスト" onClose={onClose}>
        <p>本文</p>
      </Modal>
    );
    await user.click(screen.getByText('本文'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closeOnBackdrop=false のとき、背景クリックでは閉じない', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <Modal title="テスト" onClose={onClose} closeOnBackdrop={false}>
        <p>本文</p>
      </Modal>
    );
    await user.click(container.firstChild as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Tabキーでフォーカスがモーダルの外に出ない', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button>外のボタン</button>
        <Modal title="テスト" onClose={() => {}}>
          <button>内側のボタン</button>
        </Modal>
      </>
    );
    // 閉じる×ボタン → 内側のボタン → （循環して）閉じる×ボタン
    await user.tab();
    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: '閉じる' })).toHaveFocus();
    expect(screen.getByRole('button', { name: '外のボタン' })).not.toHaveFocus();
  });
});
