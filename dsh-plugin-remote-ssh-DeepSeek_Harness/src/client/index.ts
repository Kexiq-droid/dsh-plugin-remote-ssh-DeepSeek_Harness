import { RemoteSshUiController } from './ui-controller';

export const name = 'remote-ssh-client';

export function apply(ctx: any): void {
  const rpcInvoker = {
    invoke: async (channel: string, payload?: any) => {
      if (ctx.rpc?.invoke) return ctx.rpc.invoke(channel, payload);
      if (ctx.client?.invoke) return ctx.client.invoke(channel, payload);
      if ((window as any).dsh?.rpc?.invoke) return (window as any).dsh.rpc.invoke(channel, payload);
      throw new Error(`RPC канал ${channel} недоступен в текущем контексте Client`);
    }
  };

  const controller = new RemoteSshUiController(rpcInvoker);

  const slotComponent = {
    name: 'RemoteSshStatusBarButton',
    mount(el: HTMLElement) {
      controller.mountStatusBarButton(el);
    },
    render() {
      const wrapper = document.createElement('div');
      wrapper.style.display = 'inline-flex';
      wrapper.style.marginLeft = 'auto';
      controller.mountStatusBarButton(wrapper);
      return wrapper;
    }
  };

  if (ctx.slot?.register) {
    ctx.slot.register('shell.bottom', slotComponent, { align: 'right', order: 1000 });
    ctx.slot.register('status-bar.right', slotComponent, { order: 1000 });
  } else if (ctx.ui?.registerSlot) {
    ctx.ui.registerSlot('shell.bottom', slotComponent);
  }
}

export default { name, apply };