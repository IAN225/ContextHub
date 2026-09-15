import type { PetPack } from './contracts';
export const builtinPet: PetPack = {
  schemaVersion: 1,
  name: '邮差小猫',
  animations: {
    idle: {
      fps: 3,
      loop: true,
      frames: [
        {
          src: '/pets/post-cat/idle/001.png',
          width: 96,
          height: 96,
        },
        {
          src: '/pets/post-cat/idle/002.png',
          width: 96,
          height: 96,
        },
        {
          src: '/pets/post-cat/idle/003.png',
          width: 96,
          height: 96,
        },
        {
          src: '/pets/post-cat/idle/004.png',
          width: 96,
          height: 96,
        },
        {
          src: '/pets/post-cat/idle/005.png',
          width: 96,
          height: 96,
        },
        {
          src: '/pets/post-cat/idle/006.png',
          width: 96,
          height: 96,
        },
      ],
    },
    drag: {
      fps: 6,
      loop: true,
      frames: [
        {
          src: '/pets/post-cat/drag/001.png',
          width: 96,
          height: 96,
        },
        {
          src: '/pets/post-cat/drag/002.png',
          width: 96,
          height: 96,
        },
      ],
    },
    mail: {
      fps: 4,
      loop: true,
      frames: [
        {
          src: '/pets/post-cat/mail/001.png',
          width: 96,
          height: 96,
        },
        {
          src: '/pets/post-cat/mail/002.png',
          width: 96,
          height: 96,
        },
        {
          src: '/pets/post-cat/mail/003.png',
          width: 96,
          height: 96,
        },
        {
          src: '/pets/post-cat/mail/004.png',
          width: 96,
          height: 96,
        },
      ],
    },
  },
};
