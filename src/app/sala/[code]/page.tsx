import type { Metadata } from 'next';
import RoomClient from '@/components/room/RoomClient';

export const metadata: Metadata = {
  title: 'Sala',
  robots: { index: false, follow: false },
};

export default function RoomPage({ params }: { params: { code: string } }) {
  const code = decodeURIComponent(params.code).toUpperCase();
  return <RoomClient key={code} code={code} />;
}
