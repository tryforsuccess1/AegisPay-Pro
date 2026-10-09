(function(){
'use strict';
var rows=[
['Mini USB Fan','Aegis Home','Home & Kitchen','Cooling',2.99,4.4,'Deal','🌀',1],
['Cable Organizer Kit','Aegis Office','Office','Desk',4.99,4.5,'New','🧷',2],
['Pocket Notebook Set','Aegis Paper','Books','Stationery',7.49,4.6,'Popular','📓',3],
['Phone Grip Stand','Aegis Mobile','Electronics','Accessories',9.99,4.5,'Best Seller','📱',4],
['Travel Water Bottle','Aegis Active','Outdoor','Hydration',12.99,4.7,'Popular','🥤',5],
['Classic Sunglasses','Aegis Style','Fashion','Accessories',15.99,4.6,'New','🕶️',6],
['LED Desk Light','Aegis Home','Office','Lighting',18.99,4.6,'Deal','💡',7],
['Wireless Mouse','Aegis Tech','Electronics','Computer Accessories',21.99,4.7,'Top Rated','🖱️',8],
['Kitchen Storage Set','Aegis Home','Home & Kitchen','Storage',24.99,4.6,'Featured','🫙',9],
['Compact Travel Pouch','Aegis Style','Fashion','Travel',29.99,4.5,'Popular','👜',10],
['Fitness Resistance Bands','Aegis Active','Sports','Training',34.99,4.7,'Best Seller','🏋️',11],
['Ceramic Coffee Mug','Aegis Home','Home & Kitchen','Drinkware',39.99,4.6,'New','☕',12],
['Desk Mat Pro','Aegis Office','Office','Desk Accessories',44.99,4.7,'Top Rated','🖥️',13],
['Glow Skin Care Set','Aegis Beauty','Beauty','Skin Care',49.99,4.8,'Best Seller','🧴',14],
['Everyday Backpack','Aegis Style','Fashion','Bags',54.99,4.7,'Featured','🎒',15],
['Smart Tracker Tag','Aegis Tech','Electronics','Smart Devices',59.99,4.4,'New','🏷️',16],
['Portable Blender','Aegis Home','Home & Kitchen','Appliances',69.99,4.6,'Deal','🥤',17],
['Gaming Mouse Pro','Aegis Game','Gaming','PC Gaming',79.99,4.8,'Top Rated','🖱️',18],
['Running Shoes Lite','Aegis Sport','Sports','Footwear',89.99,4.7,'Popular','👟',19],
['Travel Duffel Bag','Aegis Style','Fashion','Travel',99.99,4.6,'Featured','🧳',20],
['Mechanical Keyboard','Aegis Tech','Gaming','PC Gaming',109,4.8,'Best Seller','⌨️',21],
['Fitness Smart Band','Aegis Active','Sports','Wearables',119,4.6,'New','⌚',22],
['Stainless Cookware Set','Aegis Home','Home & Kitchen','Cookware',129,4.8,'Top Rated','🍳',23],
['Noise Cancel Earbuds','Aegis Audio','Electronics','Headphones',139,4.7,'Featured','🎧',24],
['Polarized Eyewear','Aegis Style','Fashion','Accessories',149,4.6,'Deal','🕶️',25],
['Office Backpack Pro','Aegis Office','Office','Bags',159,4.7,'Popular','🎒',26],
['Beauty Vanity Kit','Aegis Beauty','Beauty','Cosmetics',169,4.7,'Best Seller','💄',27],
['Air Fryer Compact','Aegis Home','Home & Kitchen','Appliances',179,4.8,'Hot','🍟',28],
['Smart Home Camera','Aegis Tech','Electronics','Smart Home',199,4.5,'New','📷',29],
['Premium Sports Watch','Aegis Active','Sports','Wearables',219,4.7,'Featured','⌚',30],
['Ultralight Tent','Aegis Outdoor','Outdoor','Camping',239,4.8,'Top Rated','⛺',31],
['Gaming Headset Elite','Aegis Game','Gaming','PC Gaming',249,4.8,'Best Seller','🎮',32],
['Robot Vacuum Mini','Aegis Home','Home & Kitchen','Appliances',269,4.6,'Deal','🧹',33],
['Leather Weekender','Aegis Style','Fashion','Travel',289,4.7,'Featured','👜',34],
['4K Streaming Box','Aegis Tech','Electronics','Entertainment',299,4.5,'Popular','📺',35],
['Ergonomic Office Chair','Aegis Office','Office','Furniture',329,4.7,'Top Rated','🪑',36],
['Pro Makeup Case','Aegis Beauty','Beauty','Accessories',349,4.8,'New','💼',37],
['Performance Running Kit','Aegis Active','Sports','Training',379,4.8,'Featured','🏃',38],
['Mirrorless Camera Body','Aegis Tech','Electronics','Cameras',399,4.7,'Best Seller','📷',39],
['Travel Smart Luggage','Aegis Outdoor','Outdoor','Travel',429,4.7,'New','🧳',40],
['Premium Coffee Machine','Aegis Home','Home & Kitchen','Coffee',449,4.8,'Top Rated','☕',41],
['Ultra Gaming Monitor','Aegis Game','Gaming','PC Gaming',499,4.8,'Hot','🖥️',42],
['Business Laptop Air','Aegis Tech','Electronics','Laptops',549,4.7,'Featured','💻',43],
['Designer Carry-On','Aegis Style','Fashion','Travel',599,4.7,'Popular','🧳',44],
['Smart Fitness Station','Aegis Active','Sports','Training',649,4.9,'Top Rated','🏋️',45],
['Home Theater System','Aegis Tech','Electronics','Entertainment',699,4.6,'Best Seller','📺',46],
['Premium Espresso Bar','Aegis Home','Home & Kitchen','Coffee',749,4.8,'Featured','☕',47],
['Creator Laptop Pro','Aegis Tech','Electronics','Laptops',799,4.8,'Top Rated','💻',48],
['Luxury Outdoor Set','Aegis Outdoor','Outdoor','Furniture',849,4.7,'New','🪵',49],
['Studio Camera Kit','Aegis Tech','Electronics','Cameras',899,4.8,'Featured','📷',50],
['Executive Workspace','Aegis Office','Office','Furniture',929,4.7,'Premium','🪑',51],
['Flagship Smart Device','Aegis Tech','Electronics','Smart Devices',949,4.6,'Premium','📱',52],
['Luxury Travel Trunk','Aegis Style','Fashion','Luggage',959,4.8,'Premium','🧳',53],
['Home Wellness Suite','Aegis Home','Home & Kitchen','Wellness',969,4.7,'Premium','🛁',54],
['Pro Creator Bundle','Aegis Tech','Gaming','Creator Gear',979,4.9,'Premium','🎥',55],
['Elite Fitness Bundle','Aegis Active','Sports','Training',989,4.8,'Premium','🏆',56],
['Aegis Signature Collection','Aegis Style','Fashion','Signature',999,4.9,'Signature','👑',57],
['Wireless Charging Hub','Aegis Tech','Electronics','Charging',31.99,4.5,'New','🔋',58],
['Smart Kitchen Scale','Aegis Home','Home & Kitchen','Kitchen Tools',36.99,4.6,'Popular','⚖️',59],
['Portable Projector','Aegis Tech','Electronics','Projectors',189,4.6,'Featured','📽️',60]
];
var PRODUCT_IMAGES={
  tech:'https://images.unsplash.com/photo-1769689268229-3e9c9ddaf1ee?auto=format&fit=crop&w=900&q=82',
  laptop:'https://images.unsplash.com/photo-1610006330187-5f0c6ec0f9aa?auto=format&fit=crop&w=900&q=82',
  bag:'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=900&q=82',
  camera:'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=900&q=82',
  shoes:'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=900&q=82',
  watch:'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=900&q=82',
  headphones:'https://images.unsplash.com/photo-1674658556545-f18d4080ab6c?auto=format&fit=crop&w=900&q=82',
  coffee:'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=900&q=82',
  chair:'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&w=900&q=82',
  home:'https://images.unsplash.com/photo-1556910103-1c02745aae4d?auto=format&fit=crop&w=900&q=82'
};

var ACTIVE_PRODUCT_OVERRIDES={
  'SP-4':{title:'Phone Grip Stand',brand:'PopSockets'},
  'SP-8':{title:'Logitech M220 Silent Wireless Mouse',brand:'Logitech'},
  'SP-16':{title:'Smart Bluetooth Tracker Tag',brand:'Tile'},
  'SP-19':{title:'adidas Response 2 Running Shoes',brand:'adidas'},
  'SP-21':{title:'Keychron K8 Pro Mechanical Keyboard',brand:'Keychron'},
  'SP-24':{title:'Liberty 4 Pro Noise Cancelling Earbuds',brand:'soundcore'},
  'SP-32':{title:'Wireless Gaming Headset Elite',brand:'Aegis Game'},
  'SP-40':{title:'Heys SmartLuggage 26"',brand:'Heys'},
  'SP-42':{title:'AOC 27" Curved Gaming Monitor',brand:'AOC'},
  'SP-44':{title:'Designer Carry-On',brand:'Travel Collection'},
  'SP-52':{title:'Flagship Smartphone',brand:'Aegis Tech'},
  'SP-57':{title:'Premium Signature Crossbody Bag',brand:'Aegis Signature'}
};
var GALLERY_BY_ID={
  'SP-4':[
    'https://arqoob.com/uploads/img/pi/175/175411768300/medium_1754117683.webp',
    'https://brave.ae/assets/images/1762178278_5769ff322d287431.png',
    'https://simplecellbulk.com/cdn/shop/products/t84581-1__1_5e5a5f79-9631-41f8-8636-54af371941af.jpg?v=1681993849',
    'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=900&q=88',
    'https://images.unsplash.com/photo-1546054454-aa26e2b734c7?auto=format&fit=crop&w=900&q=88'
  ],
  'SP-8':[
    'https://images.tcdn.com.br/img/img_prod/571937/mouse_sem_fio_logitech_m220_silent_preto_1_20260525094106_b1bcd4eba880.png',
    'https://images.tcdn.com.br/img/img_prod/571937/mouse_sem_fio_logitech_m220_silent_preto_2_20260525094106_1075ce0dac61.png',
    'https://images.tcdn.com.br/img/img_prod/571937/mouse_sem_fio_logitech_m220_silent_preto_3_20260525094106_f7303a8dffdb.png',
    'https://images.tcdn.com.br/img/img_prod/571937/mouse_sem_fio_logitech_m220_silent_preto_4_20260525094106_d0ce338d6f56.png',
    'https://images.tcdn.com.br/img/img_prod/571937/mouse_sem_fio_logitech_m220_silent_preto_5_20260525094106_a040ff5c6b0d.png'
  ],
  'SP-16':[
    'https://images-na.ssl-images-amazon.com/images/I/610OXBcjEzL.jpg',
    'https://s.alicdn.com/%40sc04/kf/H2439dcae96f94640aedea5300067648fA/Custom-Logo-Android-Smart-Phone-Tag-for-Google-Sony-Xiaomi-Smart-Phones-Key-Finder-Anti-Lost-Pet-Bike-Tracker.jpg',
    'https://shop.letstrack.com/cdn/shop/files/smart-tag-ios.jpg?v=1757070065&width=1024',
    'https://www.vimeltech.com.au/image/cache/catalog/2026/VIM-TAG-A1/tracker-tag-keyring-hand-held-550x550.jpg',
    'https://images.unsplash.com/photo-1577598629456-7f4f7b3adf6e?auto=format&fit=crop&w=900&q=88'
  ],
  'SP-19':[
    'https://assets.adidas.com/images/w_500%2Cf_auto%2Cq_auto/8a03725e19834c7c914202a7c6ac8f5e_9366/RESPONSE_2_RUNNING_SHOES_Red_KJ1752_01_00_standard.jpg',
    'https://assets.adidas.com/images/w_500%2Cf_auto%2Cq_auto/be4dc1a6a8c24988bd5d3f9931cc9dc8_9366/RESPONSE_2_RUNNING_SHOES_Red_KJ1752_02_standard_hover.jpg',
    'https://assets.adidas.com/images/w_500%2Cf_auto%2Cq_auto/38d6fbfc88fb47b9ad6356c5d6a601a1_9366/RESPONSE_2_RUNNING_SHOES_Red_KJ1752_03_standard.jpg',
    'https://assets.adidas.com/images/w_500%2Cf_auto%2Cq_auto/7def225541b744e2985a9e4a82f12687_9366/RESPONSE_2_RUNNING_SHOES_Red_KJ1752_04_standard.jpg',
    'https://contents.mediadecathlon.com/p1567822/k%24192043c18a8a8cacb793c158042bd4c7/laufschuhe-run-support-herren-rot.jpg'
  ],
  'SP-21':[
    'https://cdn.shopify.com/s/files/1/0059/0630/1017/t/5/assets/keychronk8proqmkviawirelessmechanicalkeyboardformacwindowsosaprofilepbtkeycapspcbscrewinstabilizerwithhotswappablegaterongpromechanicalswitchcompatiblewithmxcherrypandakailhwithrgbbacklightaluminumframe-1645094681965.jpg?v=1645094684',
    'https://cdn.shopify.com/s/files/1/0059/0630/1017/files/K8-Pro-White.jpg?v=1688090606',
    'https://cdn.shopify.com/s/files/1/0059/0630/1017/files/K8-Pro-non-hot-swappable-version.jpg?v=1692007807',
    'https://cdn.shopify.com/s/files/1/0059/0630/1017/t/5/assets/keychronk8proqmkviawirelessmechanicalkeyboardformacwindowsosaprofilepbtkeycapspcbscrewinstabilizerwithhotswappablegaterongpromechanicalswitchcompatiblewithmxcherrypandakailhwithrgbbacklightaluminumframe-1646107816821.jpg?v=1646107819',
    'https://www.jib.co.th/img_master/product/original/20180809174303_30351_24_1.png',
    'https://mechanicalkeyboards.com/cdn/shop/files/24061-9M62T-Keychron-K8-V2-Aluminum-Hotswap-RGB-Keyboard.jpg?v=1734988025&width=750'
  ],
  'SP-24':[
    'https://m.media-amazon.com/images/S/aplus-media-library-service-media/2b8278d7-02c3-490e-94e0-e33e9f84400b.__CR0%2C0%2C1464%2C600_PT0_SX1464_V1___.jpg',
    'https://m.media-amazon.com/images/S/aplus-media-library-service-media/f20411e3-e7f3-451e-804d-7caa78b4e72f.__CR0%2C0%2C1464%2C600_PT0_SX1464_V1___.jpg',
    'https://m.media-amazon.com/images/S/aplus-media-library-service-media/735f982f-ae74-4310-b1fc-b9e56631cafd.__CR0%2C0%2C1464%2C600_PT0_SX1464_V1___.jpg',
    'https://images-na.ssl-images-amazon.com/images/I/61loiB6QjoL.jpg',
    'https://img.joomcdn.net/b216d373a5a6c4a7272d4eec42ad543262f7cedf_1024_1024.jpeg',
    'https://www.segment.com.tr/images/productimages/SL_TWS04_B_02.jpg',
    'https://image.made-in-china.com/2f0j00sfZkUHQzuToR/Tws-Charging-in-Ear-Wireless-Game-Headset-Cheap-Bluetooth-5-2-Noise-Cancellation-Headphone.webp'
  ],
  'SP-32':[
    'https://resource.logitechg.com/w_544%2Ch_466%2Car_7%3A6%2Cc_pad%2Cq_auto%2Cf_auto%2Cdpr_1.0/d_transparent.gif/content/dam/gaming/en/products/g733/gallery/g733-lilac-gallery-2.png',
    'https://resource.logitechg.com/w_544%2Ch_466%2Car_7%3A6%2Cc_pad%2Cq_auto%2Cf_auto%2Cdpr_1.0/d_transparent.gif/content/dam/gaming/en/products/g733/gallery/g733-lilac-gallery-3.png',
    'https://resource.logitechg.com/w_544%2Ch_544%2Car_1%2Cc_fill%2Cq_auto%2Cf_auto%2Cdpr_1.0/d_transparent.gif/content/dam/gaming/en/products/g733/g733-hpb-desktop.png',
    'https://media.ldlc.com/r705/mktp/product/productImage/240702/92/bed9a292e52e4d41a6c288b5236791e6.webp',
    'https://dubsnatch.com/cdn/shop/products/neon-rgb-black-gaming-headset-microphone-jack-usb-dubsnatch_600x.jpg?v=1673069964'
  ],
  'SP-40':[
    'https://eu.heys.com/cdn/shop/products/SmartLuggage_26_frontqrt_black_Hand.jpg?v=1557326945&width=750',
    'https://eu.heys.com/cdn/shop/files/SmartLuggage-Black-26-Inch-heys-luggage-lifestyle-image-1_ff13c23e-577f-4005-9019-8691fe5c3cd2.jpg?v=1746115566&width=500',
    'https://eu.heys.com/cdn/shop/products/SmartLuggage_features_5batteries.jpg?v=1746115566&width=750',
    'https://eu.heys.com/cdn/shop/files/SmartLuggage-Black-26-Inch-heys-luggage-lifestyle-image-2_97c51421-c868-4be2-8cbc-4650f15c16d6.jpg?v=1746115566&width=500',
    'https://eu.heys.com/cdn/shop/products/SmartLuggage_26_open_1ba1375b-5724-4d2c-bfb6-db27196d0237.jpg?v=1746115566&width=750',
    'https://eu.heys.com/cdn/shop/products/SmartLuggage_26_isometric_front-icons_05856bf1-1223-4190-8f4b-646e2b00467b.jpg?v=1746115566&width=750',
    'https://eu.heys.com/cdn/shop/products/SmartLuggage_features_2proximity_e405073e-14c7-471d-be77-c8764a0864d7.jpg?v=1746115566&width=750'
  ],
  'SP-42':[
    'https://cdn.sanity.io/images/hf5b3axp/production/250e10d12e65d14cecb1a834b735b7b531329cb4-1500x1500.png?auto=format&fit=max&w=800',
    'https://cdn.sanity.io/images/hf5b3axp/production/63476a1cd86fda14d7b8f01ec30dea0be9e3d891-1920x1920.png?auto=format&fit=max&w=800',
    'https://cdn.sanity.io/images/hf5b3axp/production/ba93d21a74c18eaf8c0514d48d524e0a89d66a55-1500x1500.png?auto=format&fit=max&w=800',
    'https://cdn.sanity.io/images/hf5b3axp/production/7b9f6d384c6dee65e2dd8f167f45334067c8ab7c-3840x1500.png?auto=format&fit=max&w=800',
    'https://www.laptopsdirect.co.uk/Images/C27G4ZXE_1_Supersize.jpg?v=3'
  ],
  'SP-44':[
    'https://assets.target.com.au/transform/f6c96a96-ea6e-461b-a267-a01baea60a2a/43114962-8?io=transform%3Afit%2Cwidth%3A1400%2Cheight%3A1600&output=webp&quality=90',
    'https://cdn.mos.cms.futurecdn.net/whowhatwear/posts/278107/designer-luggage-sets-278107-1551672255228-product.png',
    'https://urbantravellerco.id/cdn/shop/files/thecarryonpro-greychocolate.webp?v=1702287221&width=1445',
    'https://brain-images-ssl.cdn.dixons.com/3/5/10146753/l_10146753_006.jpg',
    'https://www.n-sport.net/UserFiles/products/big/05/06/zenska-torba-karl-lagerfeld-k-signature-shoulderbag-201W3100-783.jpg',
    'https://www.cocoon.club/cdn/shop/products/GUCCI_GG-Marmont-Matelasse-Mini-Crossbody_Black_Leather_FRONT_grande.jpg?v=1621332282'
  ],
  'SP-52':[
    'https://image01-eu.oneplus.net/shop/202104/27/1-M00-24-8B-rB8bwmCICVmAWJYwAAb0g1C5KSs370.png',
    'https://static.wixstatic.com/media/c2b8f0_4036c43680524933b8d1a071d97da1ae~mv2.jpg/v1/fill/w_780%2Ch_480%2Cal_c%2Clg_1%2Cq_85/c2b8f0_4036c43680524933b8d1a071d97da1ae~mv2.jpg',
    'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=900&q=88',
    'https://images.unsplash.com/photo-1598327105666-5b89351aff97?auto=format&fit=crop&w=900&q=88',
    'https://images.unsplash.com/photo-1546054454-aa26e2b734c7?auto=format&fit=crop&w=900&q=88'
  ],
  'SP-57':[
    'https://urbantravellerco.id/cdn/shop/files/thecarryonpro-greychocolate.webp?v=1702287221&width=1445',
    'https://www.cocoon.club/cdn/shop/products/GUCCI_GG-Marmont-Matelasse-Mini-Crossbody_Black_Leather_FRONT_grande.jpg?v=1621332282',
    'https://www.n-sport.net/UserFiles/products/big/05/06/zenska-torba-karl-lagerfeld-k-signature-shoulderbag-201W3100-783.jpg',
    'https://assets.target.com.au/transform/f6c96a96-ea6e-461b-a267-a01baea60a2a/43114962-8?io=transform%3Afit%2Cwidth%3A1400%2Cheight%3A1600&output=webp&quality=90',
    'https://cdn.mos.cms.futurecdn.net/whowhatwear/posts/278107/designer-luggage-sets-278107-1551672255228-product.png',
    'https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=900&q=88'
  ]
};
function productImage(x){
  var s=(x[0]+' '+x[1]+' '+x[2]+' '+x[3]).toLowerCase();
  if(/camera|creator|streaming|photo/.test(s))return PRODUCT_IMAGES.camera;
  if(/laptop|keyboard|monitor|mouse|computer/.test(s))return PRODUCT_IMAGES.laptop;
  if(/headphone|earbud|audio/.test(s))return PRODUCT_IMAGES.headphones;
  if(/phone|smart device|charger|charging/.test(s))return PRODUCT_IMAGES.tech;
  if(/shoe|running|fitness|sport|training|gym/.test(s))return PRODUCT_IMAGES.shoes;
  if(/watch|wearable/.test(s))return PRODUCT_IMAGES.watch;
  if(/backpack|bag|luggage|travel|pouch|makeup case/.test(s))return PRODUCT_IMAGES.bag;
  if(/chair|furniture|office/.test(s))return PRODUCT_IMAGES.chair;
  if(/coffee|mug|espresso/.test(s))return PRODUCT_IMAGES.coffee;
  if(/home|kitchen|cook|air fryer|blender|vacuum/.test(s))return PRODUCT_IMAGES.home;
  return PRODUCT_IMAGES.tech;
}
window.AegisShopCatalog=rows.map(function(x){
  var id='SP-'+x[8],g=GALLERY_BY_ID[id]||[],ov=ACTIVE_PRODUCT_OVERRIDES[id]||{};
  return{id:id,title:ov.title||x[0],brand:ov.brand||x[1],category:ov.category||x[2],subcategory:x[3],marketPrice:x[4],rating:x[5],badge:x[6],emoji:x[7],image:g[0]||productImage(x),gallery:g};
});
})();
