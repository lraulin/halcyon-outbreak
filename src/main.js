import { Game } from './game.js';

const game = new Game(document.getElementById('app'));
window.game = game;

document.getElementById('start-btn').addEventListener('click', () => game.start());
if (window.location.hash === '#play') game.start();
document.getElementById('restart-btn').addEventListener('click', () => window.location.reload());
