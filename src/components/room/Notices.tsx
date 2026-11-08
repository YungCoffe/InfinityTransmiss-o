import { Icon } from '@/components/Icon';

export default function Notices({ host }: { host: boolean }) {
  return (
    <details open className="card p-4 text-sm">
      <summary className="flex cursor-pointer items-center gap-2 text-base font-black">
        <Icon name="alert" size={18} />
        Avisos importantes
      </summary>
      <ul className="mt-3 list-disc space-y-2 pl-5 font-medium text-zinc-800">
        {host ? (
          <>
            <li>Mantenha esta aba aberta enquanto transmite. Você pode trocar de aba ou minimizar o navegador, mas se a aba for fechada a transmissão para.</li>
            <li>Nada é capturado com o site fechado, e nada é gravado nos nossos servidores.</li>
            <li>No celular, compartilhar a tela inteira depende do sistema (iOS e Android) e do navegador. Na maioria dos celulares isso não está disponível: transmita de um computador.</li>
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
