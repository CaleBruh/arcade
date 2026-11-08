'use strict';

/* Question bank for the quiz.

   Deliberately a plain file outside server/sims/, for two reasons: anything
   in sims/ must export make() or the registry throws, and this is the one
   file someone running a party will actually want to edit. Add your own and
   the game picks them up on restart — no other change needed.

   Format: [question, [four options], index of the correct one, category].
   Keep options short; they are read off a phone screen in a noisy room. */

const QUESTIONS = [
  // ---- geography ----
  ['Which country has the most natural lakes?', ['Canada', 'Russia', 'Finland', 'Brazil'], 0, 'Geography'],
  ['What is the capital of Australia?', ['Sydney', 'Melbourne', 'Canberra', 'Perth'], 2, 'Geography'],
  ['Which desert is the largest hot desert on Earth?', ['Gobi', 'Sahara', 'Kalahari', 'Arabian'], 1, 'Geography'],
  ['Mount Everest sits on the border of Nepal and which country?', ['India', 'Bhutan', 'China', 'Pakistan'], 2, 'Geography'],
  ['Which river runs through Paris?', ['Loire', 'Rhône', 'Seine', 'Garonne'], 2, 'Geography'],
  ['How many time zones does Russia span?', ['7', '9', '11', '13'], 2, 'Geography'],
  ['Which is the only country that borders both the Atlantic and Indian oceans?', ['South Africa', 'Egypt', 'Morocco', 'Somalia'], 0, 'Geography'],
  ['What is the smallest country in the world by area?', ['Monaco', 'Nauru', 'Vatican City', 'San Marino'], 2, 'Geography'],

  // ---- science ----
  ['What is the most abundant gas in Earth’s atmosphere?', ['Oxygen', 'Nitrogen', 'Carbon dioxide', 'Argon'], 1, 'Science'],
  ['How many bones are in an adult human body?', ['186', '206', '226', '246'], 1, 'Science'],
  ['What is the chemical symbol for gold?', ['Go', 'Gd', 'Au', 'Ag'], 2, 'Science'],
  ['Which planet has the most moons?', ['Jupiter', 'Saturn', 'Uranus', 'Neptune'], 1, 'Science'],
  ['What does DNA stand for?', ['Deoxyribonucleic acid', 'Dinucleic acid', 'Diribonucleic acid', 'Deoxyribose nitrate'], 0, 'Science'],
  ['At what temperature are Celsius and Fahrenheit equal?', ['0', '-40', '-100', '32'], 1, 'Science'],
  ['What is the hardest naturally occurring substance?', ['Quartz', 'Diamond', 'Titanium', 'Obsidian'], 1, 'Science'],
  ['How long does light from the Sun take to reach Earth?', ['8 seconds', '8 minutes', '8 hours', '80 minutes'], 1, 'Science'],
  ['Which blood type is the universal donor?', ['AB+', 'A-', 'O-', 'B+'], 2, 'Science'],
  ['What force keeps planets in orbit?', ['Magnetism', 'Gravity', 'Inertia', 'Friction'], 1, 'Science'],

  // ---- history ----
  ['In which year did the Berlin Wall fall?', ['1987', '1989', '1991', '1993'], 1, 'History'],
  ['Who was the first person to walk on the Moon?', ['Buzz Aldrin', 'Yuri Gagarin', 'Neil Armstrong', 'Michael Collins'], 2, 'History'],
  ['The Rosetta Stone was key to deciphering which writing system?', ['Cuneiform', 'Hieroglyphs', 'Linear B', 'Runes'], 1, 'History'],
  ['Which empire built Machu Picchu?', ['Aztec', 'Maya', 'Inca', 'Olmec'], 2, 'History'],
  ['How long did the Hundred Years’ War last?', ['100 years', '116 years', '99 years', '76 years'], 1, 'History'],
  ['Who wrote the Declaration of Independence?', ['Washington', 'Franklin', 'Jefferson', 'Adams'], 2, 'History'],
  ['Which ship sank in 1912 on its maiden voyage?', ['Lusitania', 'Britannic', 'Titanic', 'Olympic'], 2, 'History'],
  ['The Great Fire of London happened in which year?', ['1606', '1666', '1686', '1706'], 1, 'History'],

  // ---- arts & words ----
  ['Who painted "The Starry Night"?', ['Monet', 'Van Gogh', 'Cézanne', 'Gauguin'], 1, 'Arts'],
  ['How many strings does a standard violin have?', ['4', '5', '6', '7'], 0, 'Arts'],
  ['Who wrote "Nineteen Eighty-Four"?', ['Aldous Huxley', 'George Orwell', 'Ray Bradbury', 'H.G. Wells'], 1, 'Arts'],
  ['Which instrument has 88 keys?', ['Organ', 'Piano', 'Harpsichord', 'Accordion'], 1, 'Arts'],
  ['In which city is the Louvre?', ['Rome', 'Madrid', 'Paris', 'Vienna'], 2, 'Arts'],
  ['What is the longest-running Broadway show?', ['Cats', 'Chicago', 'The Phantom of the Opera', 'Les Misérables'], 2, 'Arts'],
  ['Which Shakespeare play features the line "To be, or not to be"?', ['Macbeth', 'Hamlet', 'Othello', 'King Lear'], 1, 'Arts'],

  // ---- sport & games ----
  ['How many players are on a football (soccer) team on the pitch?', ['9', '10', '11', '12'], 2, 'Sport'],
  ['How often are the Summer Olympics held?', ['Every 2 years', 'Every 3 years', 'Every 4 years', 'Every 5 years'], 2, 'Sport'],
  ['In chess, how many squares are on the board?', ['36', '49', '64', '81'], 2, 'Sport'],
  ['Which country has won the most FIFA World Cups?', ['Germany', 'Italy', 'Argentina', 'Brazil'], 3, 'Sport'],
  ['How many points is a touchdown worth in American football?', ['3', '6', '7', '8'], 1, 'Sport'],
  ['In tennis, what is a score of zero called?', ['Nil', 'Love', 'Duck', 'Blank'], 1, 'Sport'],

  // ---- food & everyday ----
  ['Which spice is the most expensive by weight?', ['Vanilla', 'Cardamom', 'Saffron', 'Cinnamon'], 2, 'Food'],
  ['What is the main ingredient in guacamole?', ['Pea', 'Avocado', 'Courgette', 'Lime'], 1, 'Food'],
  ['Which fruit has its seeds on the outside?', ['Kiwi', 'Strawberry', 'Fig', 'Pomegranate'], 1, 'Food'],
  ['Honey never spoils because it is naturally low in what?', ['Sugar', 'Water', 'Acid', 'Protein'], 1, 'Food'],
  ['What kind of pastry is used for profiteroles?', ['Puff', 'Filo', 'Choux', 'Shortcrust'], 2, 'Food'],

  // ---- technology ----
  ['What does "HTTP" stand for?', ['HyperText Transfer Protocol', 'High Transfer Text Protocol', 'HyperText Transit Protocol', 'Host Transfer Protocol'], 0, 'Tech'],
  ['How many bits are in a byte?', ['4', '8', '16', '32'], 1, 'Tech'],
  ['Who is credited with writing the first computer algorithm?', ['Alan Turing', 'Ada Lovelace', 'Grace Hopper', 'Charles Babbage'], 1, 'Tech'],
  ['What does "GPU" stand for?', ['General Processing Unit', 'Graphics Processing Unit', 'Grid Power Unit', 'Global Processing Unit'], 1, 'Tech'],
  ['Which company created the first iPhone?', ['Nokia', 'Samsung', 'Apple', 'BlackBerry'], 2, 'Tech'],
  ['In binary, what is the decimal number 8?', ['110', '1000', '1010', '1100'], 1, 'Tech'],
  ['What does "Wi-Fi" connect you to locally?', ['A satellite', 'A router', 'A cell tower', 'A server farm'], 1, 'Tech'],

  // ---- nature ----
  ['What is the largest mammal on Earth?', ['African elephant', 'Blue whale', 'Giraffe', 'Orca'], 1, 'Nature'],
  ['How many hearts does an octopus have?', ['1', '2', '3', '4'], 2, 'Nature'],
  ['Which bird is the fastest in level flight?', ['Peregrine falcon', 'Swift', 'Albatross', 'Eagle'], 1, 'Nature'],
  ['A group of crows is called a what?', ['Flock', 'Murder', 'Pack', 'Herd'], 1, 'Nature'],
  ['Which animal has the longest lifespan?', ['Tortoise', 'Greenland shark', 'Elephant', 'Parrot'], 1, 'Nature'],
  ['Bees communicate direction by doing what?', ['Singing', 'Dancing', 'Tapping', 'Glowing'], 1, 'Nature'],
  ['What is the only mammal capable of true flight?', ['Flying squirrel', 'Bat', 'Colugo', 'Sugar glider'], 1, 'Nature'],
];

module.exports = { QUESTIONS };
