import { Icon } from '@/components/Icon';

import { memo } from 'react';

function Notices({ host }: { host: boolean }) {
  return (
    <details open className="card p-4 text-sm">
      <summary className="flex cursor-pointer items-center gap-2 text-base font-black">
        <Icon name="alert" size={18} />
        Avisos importantes
      </summary>
      <ul className="mt-3 list-disc space-y-2 pl-5 font-medium text-zinc-800">
        {host ? (
          <>
            <li>Mantenha esta aba aberta enquanto transmite. No computador você pode trocar de aba ou minimizar o navegador; se a aba for fechada, a transmissão para.</li>
            <li>No celular, deixe o navegador aberto e a tela ligada: o iPhone e o Android pausam a câmera quando o navegador vai para segundo plano. O app mantém a tela acesa por você.</li>
            <li>Compartilhar a tela depende do sistema e do navegador e, na maioria dos celulares, não está disponível. Pelo celular, transmita pela câmera e microfone.</li>
            <li>Nada é capturado com o site fechado, e nada é gravado nos nossos servidores.</li>
          </>
        ) : (
          <>
            <li>Para continuar assistindo em segundo plano, use o botão Picture-in-Picture quando ele aparecer.</li>
            <li>No iPhone e no iPad o vídeo pode pausar ao sair do navegador. No Android o comportamento varia conforme o navegador.</li>
            <li>Se a imagem travar, use “Tentar de novo” ou recarregue a página: você volta para a mesma sala.</li>
          </>
        )}
      </ul>
    </details>
  );
}

export default memo(Notices);
